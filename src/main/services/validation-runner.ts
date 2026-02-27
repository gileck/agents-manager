import type { AgentMode, AgentRunResult, AgentConfig, AgentContext, AgentChatMessage } from '../../shared/types';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IAgent } from '../interfaces/agent';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getShellEnv } from './shell-env';

const execAsync = promisify(exec);

const NON_VALIDATABLE_MODES: readonly AgentMode[] = [
  'plan', 'plan_revision', 'plan_resume',
  'investigate', 'investigate_resume',
  'technical_design', 'technical_design_revision', 'technical_design_resume',
];

export class ValidationRunner {
  constructor(
    private agentRunStore: IAgentRunStore,
    private taskEventLog: ITaskEventLog,
  ) {}

  static getValidationCommands(mode: AgentMode, projectConfig?: Record<string, unknown>): string[] {
    if (NON_VALIDATABLE_MODES.includes(mode)) return [];
    return (projectConfig?.validationCommands as string[] | undefined) ?? [];
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
    wrappedOnOutput?: (chunk: string) => void;
    onLog: (message: string, data?: Record<string, unknown>) => void;
    onPromptBuilt: (prompt: string) => void;
    wrappedOnMessage: (msg: AgentChatMessage) => void;
  }): Promise<AgentRunResult> {
    const {
      agent, context, config, run, taskId,
      validationCommands, maxRetries, initialResult,
      wrappedOnOutput, onLog, onPromptBuilt, wrappedOnMessage,
    } = params;

    let result = initialResult;
    let validationAttempts = 0;
    let validationPassed = false;
    let accumulatedInputTokens = result.costInputTokens ?? 0;
    let accumulatedOutputTokens = result.costOutputTokens ?? 0;

    if (validationCommands.length > 0) {
      onLog(`Starting post-agent validation: ${validationCommands.length} commands, maxRetries=${maxRetries}`);
    }

    while (result.exitCode === 0 && validationCommands.length > 0 && validationAttempts < maxRetries) {
      const validation = await this.runValidation(validationCommands, context.workdir);
      if (validation.passed) { validationPassed = true; break; }

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
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: 'warning',
        message: `Validation failed (attempt ${validationAttempts}/${maxRetries}), re-running agent`,
        data: { output: validation.output.slice(0, 2000) },
      });

      context.validationErrors = validation.output;
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
      const finalCheck = await this.runValidation(validationCommands, context.workdir);
      if (!finalCheck.passed) {
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'warning',
          message: `Validation still failing after ${maxRetries} retries`,
          data: { output: finalCheck.output.slice(0, 2000) },
        });
      }
    }

    if (validationCommands.length > 0) {
      onLog(`Validation complete: attempts=${validationAttempts}, passed=${validationPassed}`);
    }

    return result;
  }

  private async runValidation(commands: string[], cwd: string): Promise<{ passed: boolean; output: string }> {
    const results: string[] = [];
    for (const cmd of commands) {
      try {
        await execAsync(cmd, { cwd, env: getShellEnv(), timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
      } catch (err: unknown) {
        const e = err as { code?: number | string; stdout?: string; stderr?: string };
        const exitCode = e.code ?? '?';
        results.push(`$ ${cmd} (exit ${exitCode})\n${e.stdout ?? ''}${e.stderr ?? ''}`);
      }
    }
    return results.length === 0
      ? { passed: true, output: '' }
      : { passed: false, output: results.join('\n\n') };
  }
}
