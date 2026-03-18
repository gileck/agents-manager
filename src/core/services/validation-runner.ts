import type { AgentRunResult, AgentConfig, AgentContext, AgentChatMessage } from '../../shared/types';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IAgent } from '../interfaces/agent';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getShellEnv } from './shell-env';

const execAsync = promisify(exec);

const NON_VALIDATABLE_AGENT_TYPES = new Set([
  'planner', 'designer', 'investigator', 'reviewer', 'task-workflow-reviewer', 'post-mortem-reviewer',
]);

export interface CommandValidationResult {
  command: string;
  passed: boolean;
  exitCode: number | string;
  output: string;
}

export type ExecCommandFn = (
  cmd: string,
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export class ValidationRunner {
  constructor(
    private agentRunStore: IAgentRunStore,
    private taskEventLog: ITaskEventLog,
    private execCommand: ExecCommandFn = execAsync,
  ) {}

  static getValidationCommands(agentType: string, projectConfig?: Record<string, unknown>): string[] {
    if (NON_VALIDATABLE_AGENT_TYPES.has(agentType)) return [];
    return (projectConfig?.validationCommands as string[] | undefined) ?? ['yarn checks'];
  }

  async runWithRetries(params: {
    agent: IAgent;
    context: AgentContext;
    config: AgentConfig;
    run: { id: string; taskId: string };
    taskId: string;
    validationCommands: string[];
    maxRetries: number;
    initialResult: AgentRunResult;
    projectPath?: string;
    wrappedOnOutput?: (chunk: string) => void;
    onLog: (message: string, data?: Record<string, unknown>) => void;
    onPromptBuilt: (prompt: string) => void;
    wrappedOnMessage: (msg: AgentChatMessage) => void;
  }): Promise<AgentRunResult> {
    const {
      agent, context, config, run, taskId,
      validationCommands, maxRetries, initialResult, projectPath,
      wrappedOnOutput, onLog, onPromptBuilt, wrappedOnMessage,
    } = params;

    let result = initialResult;
    let validationAttempts = 0;
    let validationPassed = false;
    let accumulatedInputTokens = result.costInputTokens ?? 0;
    let accumulatedOutputTokens = result.costOutputTokens ?? 0;

    // Cache of commands that also fail on main (pre-existing failures).
    // Populated on first failure comparison and reused for subsequent retries.
    let preExistingCommands: Set<string> | undefined;

    if (validationCommands.length > 0) {
      onLog(`Starting post-agent validation: ${validationCommands.length} commands, maxRetries=${maxRetries}`);
    }

    while (result.exitCode === 0 && validationCommands.length > 0 && validationAttempts < maxRetries) {
      const perCommand = await this.runValidationPerCommand(validationCommands, context.workdir);
      const allPassed = perCommand.every(r => r.passed);
      if (allPassed) { validationPassed = true; break; }

      // On first failure, compare with main to identify pre-existing issues
      if (preExistingCommands === undefined && projectPath) {
        preExistingCommands = await this.compareWithMain(perCommand, projectPath, onLog);
      }

      // Separate new failures from pre-existing
      const failedResults = perCommand.filter(r => !r.passed);
      const newFailures = preExistingCommands
        ? failedResults.filter(r => !preExistingCommands!.has(r.command))
        : failedResults;

      // If all failures are pre-existing, treat as pass
      if (newFailures.length === 0) {
        onLog('All validation failures are pre-existing on main — treating as pass');
        validationPassed = true;
        break;
      }

      // Guard: verify the run we are about to retry still belongs to this task.
      const currentRun = await this.agentRunStore.getRun(run.id);
      if (!currentRun || currentRun.taskId !== taskId) {
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'error',
          message: `Validation retry aborted: run ${run.id} does not belong to task ${taskId} (found taskId=${currentRun?.taskId ?? 'null'})`,
          data: { runId: run.id, expectedTaskId: taskId, actualTaskId: currentRun?.taskId },
        });
        break;
      }

      validationAttempts++;
      const newFailureOutput = newFailures.map(r => r.output).join('\n\n');
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: 'warning',
        message: `Validation failed (attempt ${validationAttempts}/${maxRetries}), ${newFailures.length} new failure(s), re-running agent`,
        data: { output: newFailureOutput.slice(0, 2000) },
      });

      // Only report new failures to the agent
      context.validationErrors = newFailureOutput;
      try {
        result = await agent.execute(context, config, wrappedOnOutput, onLog, onPromptBuilt, wrappedOnMessage);
      } catch (err) {
        const retryPartialInput = 'accumulatedInputTokens' in agent ? (agent as { accumulatedInputTokens?: number }).accumulatedInputTokens : undefined;
        const retryPartialOutput = 'accumulatedOutputTokens' in agent ? (agent as { accumulatedOutputTokens?: number }).accumulatedOutputTokens : undefined;
        result = { exitCode: 1, output: err instanceof Error ? err.message : String(err), outcome: 'failed', costInputTokens: retryPartialInput, costOutputTokens: retryPartialOutput };
      }
      accumulatedInputTokens += result.costInputTokens ?? 0;
      accumulatedOutputTokens += result.costOutputTokens ?? 0;
    }

    // Patch result with accumulated costs if retries occurred
    if (validationAttempts > 0) {
      result.costInputTokens = accumulatedInputTokens;
      result.costOutputTokens = accumulatedOutputTokens;
    }

    // Final validation check after retries exhausted
    if (validationAttempts === maxRetries && validationCommands.length > 0 && result.exitCode === 0) {
      const finalPerCommand = await this.runValidationPerCommand(validationCommands, context.workdir);
      const finalAllPassed = finalPerCommand.every(r => r.passed);
      if (!finalAllPassed) {
        const finalFailed = finalPerCommand.filter(r => !r.passed);
        const finalNewFailures = preExistingCommands
          ? finalFailed.filter(r => !preExistingCommands!.has(r.command))
          : finalFailed;

        if (finalNewFailures.length > 0) {
          // New failures persist after all retries — block pr_ready
          result.exitCode = 1;
          result.outcome = 'failed';
          await this.taskEventLog.log({
            taskId,
            category: 'agent',
            severity: 'warning',
            message: `Validation still failing after ${maxRetries} retries with ${finalNewFailures.length} new failure(s) — blocking pr_ready`,
            data: { output: finalNewFailures.map(r => r.output).join('\n\n').slice(0, 2000) },
          });
        } else {
          // Only pre-existing failures remain — treat as pass
          onLog('Final validation: only pre-existing failures remain — treating as pass');
        }
      }
    }

    if (validationCommands.length > 0) {
      onLog(`Validation complete: attempts=${validationAttempts}, passed=${validationPassed}`);
    }

    return result;
  }

  /** Run each validation command individually and return per-command results. */
  async runValidationPerCommand(commands: string[], cwd: string): Promise<CommandValidationResult[]> {
    const results: CommandValidationResult[] = [];
    for (const cmd of commands) {
      try {
        await this.execCommand(cmd, { cwd, env: getShellEnv(), timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
        results.push({ command: cmd, passed: true, exitCode: 0, output: '' });
      } catch (err: unknown) {
        const e = err as { code?: number | string; stdout?: string; stderr?: string };
        const exitCode = e.code ?? '?';
        const output = `$ ${cmd} (exit ${exitCode})\n${e.stdout ?? ''}${e.stderr ?? ''}`;
        results.push({ command: cmd, passed: false, exitCode, output });
      }
    }
    return results;
  }

  /**
   * Run only the failing commands against the main checkout (projectPath) and
   * return the set of commands that also fail there (pre-existing failures).
   */
  private async compareWithMain(
    worktreeResults: CommandValidationResult[],
    projectPath: string,
    onLog: (message: string, data?: Record<string, unknown>) => void,
  ): Promise<Set<string>> {
    const failingCommands = worktreeResults.filter(r => !r.passed);
    if (failingCommands.length === 0) return new Set();

    onLog(`Comparing ${failingCommands.length} failing command(s) against main at ${projectPath}`);
    const preExisting = new Set<string>();

    try {
      const mainResults = await this.runValidationPerCommand(
        failingCommands.map(r => r.command),
        projectPath,
      );
      for (const r of mainResults) {
        if (!r.passed) preExisting.add(r.command);
      }
      onLog(`Main comparison: ${preExisting.size} pre-existing, ${failingCommands.length - preExisting.size} new`);
    } catch (err) {
      onLog(`Main comparison failed, treating all failures as new: ${err instanceof Error ? err.message : String(err)}`);
    }

    return preExisting;
  }
}
