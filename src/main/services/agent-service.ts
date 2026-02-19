import type {
  AgentRun,
  AgentMode,
  AgentContext,
  AgentConfig,
  TransitionContext,
} from '../../shared/types';
import type { IAgentFramework } from '../interfaces/agent-framework';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { ITaskStore } from '../interfaces/task-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { ITaskPhaseStore } from '../interfaces/task-phase-store';
import type { IPendingPromptStore } from '../interfaces/pending-prompt-store';
import type { IAgentService } from '../interfaces/agent-service';
import type { IGitOps } from '../interfaces/git-ops';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { IAgentDefinitionStore } from '../interfaces/agent-definition-store';
import { exec } from 'child_process';
import { promisify } from 'util';
import { validateOutcomePayload } from '../handlers/outcome-schemas';
import { now } from '../stores/utils';
import { getShellEnv } from './shell-env';

const execAsync = promisify(exec);

export class AgentService implements IAgentService {
  private backgroundPromises = new Map<string, Promise<void>>();

  constructor(
    private agentFramework: IAgentFramework,
    private agentRunStore: IAgentRunStore,
    private createWorktreeManager: (projectPath: string) => IWorktreeManager,
    private taskStore: ITaskStore,
    private projectStore: IProjectStore,
    private pipelineEngine: IPipelineEngine,
    private taskEventLog: ITaskEventLog,
    private taskArtifactStore: ITaskArtifactStore,
    private taskPhaseStore: ITaskPhaseStore,
    private pendingPromptStore: IPendingPromptStore,
    private createGitOps: (cwd: string) => IGitOps,
    private taskContextStore: ITaskContextStore,
    private agentDefinitionStore: IAgentDefinitionStore,
  ) {}

  async recoverOrphanedRuns(): Promise<AgentRun[]> {
    const activeRuns = await this.agentRunStore.getActiveRuns();
    if (activeRuns.length === 0) return [];

    const recovered: AgentRun[] = [];

    for (const run of activeRuns) {
      try {
        const completedAt = now();

        // Mark run as failed/interrupted
        await this.agentRunStore.updateRun(run.id, {
          status: 'failed',
          outcome: 'interrupted',
          completedAt,
          output: (run.output ?? '') + '\n[Interrupted by app shutdown]',
        });

        // Fail the active phase
        const phase = await this.taskPhaseStore.getActivePhase(run.taskId);
        if (phase) {
          await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });
        }

        // Unlock worktree
        try {
          const task = await this.taskStore.getTask(run.taskId);
          if (task) {
            const project = await this.projectStore.getProject(task.projectId);
            if (project?.path) {
              const wm = this.createWorktreeManager(project.path);
              await wm.unlock(run.taskId);
            }
          }
        } catch {
          // Worktree may not exist — safe to ignore
        }

        // Expire pending prompts
        await this.pendingPromptStore.expirePromptsForRun(run.id);

        // Log event
        await this.taskEventLog.log({
          taskId: run.taskId,
          category: 'agent',
          severity: 'warning',
          message: 'Agent run interrupted by app shutdown',
          data: { agentRunId: run.id, agentType: run.agentType, mode: run.mode },
        });

        recovered.push({ ...run, status: 'failed', outcome: 'interrupted', completedAt });
      } catch (err) {
        console.error(`Failed to recover orphaned run ${run.id}:`, err);
      }
    }

    return recovered;
  }

  async execute(taskId: string, mode: AgentMode, agentType: string, onOutput?: (chunk: string) => void): Promise<AgentRun> {
    // 1. Fetch task + project
    const task = await this.taskStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const project = await this.projectStore.getProject(task.projectId);
    if (!project) throw new Error(`Project not found: ${task.projectId}`);

    const projectPath = project.path;
    if (!projectPath) throw new Error(`Project ${project.id} has no path configured`);
    const worktreeManager = this.createWorktreeManager(projectPath);

    // 2. Create agent run record
    const run = await this.agentRunStore.createRun({ taskId, agentType, mode });

    // 3. Manage phase
    let phase = await this.taskPhaseStore.getActivePhase(taskId);
    if (!phase) {
      phase = await this.taskPhaseStore.createPhase({ taskId, phase: mode });
    }
    await this.taskPhaseStore.updatePhase(phase.id, {
      status: 'active',
      agentRunId: run.id,
      startedAt: now(),
    });

    // 4. Prepare environment
    let worktree = await worktreeManager.get(taskId);
    if (!worktree) {
      const branch = `task/${taskId}/${mode}`;
      worktree = await worktreeManager.create(branch, taskId);
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'info',
        message: `Worktree created on branch ${branch}`,
        data: { branch, path: worktree.path, taskId },
      });
    } else {
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'info',
        message: `Worktree reused at ${worktree.path}`,
        data: { path: worktree.path },
      });
    }
    await worktreeManager.lock(taskId);
    await this.taskEventLog.log({
      taskId,
      category: 'worktree',
      severity: 'debug',
      message: 'Worktree locked',
      data: { taskId },
    });

    // 5. Clean worktree and rebase onto main so the branch only contains agent changes
    try {
      const gitOps = this.createGitOps(worktree.path);

      // Discard any uncommitted changes or untracked files left from prior runs
      await gitOps.clean();
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'debug',
        message: 'Worktree cleaned (reset uncommitted changes)',
        data: { taskId },
      });

      // Fetch and rebase onto origin/main so the branch only contains agent
      // changes and never inherits unpushed local commits from other tasks.
      await gitOps.fetch('origin');
      await gitOps.rebase('origin/main');
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'info',
        message: 'Worktree rebased onto origin/main',
        data: { taskId },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'warning',
        message: `Worktree clean/rebase failed: ${errorMsg}`,
        data: { taskId, error: errorMsg },
      });
    }

    // 6. Log event
    await this.taskEventLog.log({
      taskId,
      category: 'agent',
      severity: 'info',
      message: `Agent ${agentType} started in ${mode} mode`,
      data: { agentRunId: run.id, agentType, mode },
    });

    // 6. Build context — agent runs in the worktree, not the main checkout
    const context: AgentContext = {
      task,
      project,
      workdir: worktree.path,
      mode,
    };

    // Load accumulated task context entries for the agent
    context.taskContext = await this.taskContextStore.getEntriesForTask(taskId);

    // Look up agent definition by mode and resolve prompt template
    try {
      const agentDef = await this.agentDefinitionStore.getDefinitionByMode(mode);
      if (agentDef) {
        const modeConfig = agentDef.modes.find(m => m.mode === mode);
        if (modeConfig?.promptTemplate) {
          context.resolvedPrompt = this.resolvePromptTemplate(modeConfig.promptTemplate, context);
        }
      }
    } catch {
      // Fall through to hardcoded buildPrompt if lookup fails
    }

    const config: AgentConfig = {
      model: context.project.config?.model as string | undefined,
    };

    // 7. Fire-and-forget agent execution in background
    const agent = this.agentFramework.getAgent(agentType);
    const promise = this.runAgentInBackground(agent, context, config, run, task, phase, worktree, worktreeManager, agentType, onOutput);
    this.backgroundPromises.set(run.id, promise);

    // 8. Return run immediately (status: 'running')
    return run;
  }

  private async runAgentInBackground(
    agent: import('../interfaces/agent').IAgent,
    context: AgentContext,
    config: AgentConfig,
    run: AgentRun,
    task: import('../../shared/types').Task,
    phase: { id: string },
    worktree: { branch: string; path: string },
    worktreeManager: IWorktreeManager,
    agentType: string,
    onOutput?: (chunk: string) => void,
  ): Promise<void> {
    const taskId = task.id;
    const onLog = (message: string, data?: Record<string, unknown>) => {
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message,
        data,
      }).catch(() => {}); // fire-and-forget
    };

    // Buffer output and periodically flush to DB so it survives page refreshes
    let outputBuffer = '';
    const wrappedOnOutput = onOutput
      ? (chunk: string) => {
          outputBuffer += chunk;
          onOutput(chunk);
        }
      : undefined;
    const flushInterval = setInterval(() => {
      if (outputBuffer) {
        this.agentRunStore.updateRun(run.id, { output: outputBuffer }).catch(() => {});
      }
    }, 3000);

    const onPromptBuilt = (prompt: string) => {
      this.agentRunStore.updateRun(run.id, { prompt }).catch(() => {});
    };

    try {
      let result;
      try {
        result = await agent.execute(context, config, wrappedOnOutput, onLog, onPromptBuilt);
      } catch (err) {
        clearInterval(flushInterval);
        const errorMsg = err instanceof Error ? err.message : String(err);
        const completedAt = now();
        await this.agentRunStore.updateRun(run.id, {
          status: 'failed',
          output: errorMsg,
          outcome: 'failed',
          exitCode: 1,
          completedAt,
        });
        await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'error',
          message: `Agent ${agentType} failed: ${errorMsg}`,
          data: { agentRunId: run.id, error: errorMsg },
        });
        await worktreeManager.unlock(taskId);
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'debug',
          message: 'Worktree unlocked',
          data: { taskId },
        });

        // Attempt failure transition (pipeline may retry via hooks)
        await this.tryOutcomeTransition(taskId, 'failed', { agentRunId: run.id });
        return;
      }

      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Agent execute() returned: exitCode=${result.exitCode}, outcome=${result.outcome}, outputLength=${result.output?.length ?? 0}, costTokens=${result.costInputTokens ?? 0}/${result.costOutputTokens ?? 0}, hasStructuredOutput=${!!result.structuredOutput}`,
        data: { exitCode: result.exitCode, outcome: result.outcome, outputLength: result.output?.length ?? 0 },
      }).catch(() => {});

      // Post-agent validation loop (skip for plan/plan_revision mode — no code changes to validate)
      const validationCommands = context.mode !== 'plan' && context.mode !== 'plan_revision' && context.mode !== 'investigate'
        ? (context.project.config?.validationCommands as string[] | undefined) ?? []
        : [];
      const maxValidationRetries = (context.project.config?.maxValidationRetries as number | undefined) ?? 3;
      let validationAttempts = 0;

      if (validationCommands.length > 0) {
        this.taskEventLog.log({
          taskId,
          category: 'agent_debug',
          severity: 'debug',
          message: `Starting post-agent validation: ${validationCommands.length} commands, maxRetries=${maxValidationRetries}`,
        }).catch(() => {});
      }

      while (result.exitCode === 0 && validationCommands.length > 0 && validationAttempts < maxValidationRetries) {
        const validation = await this.runValidation(validationCommands, worktree.path);
        if (validation.passed) break;

        validationAttempts++;
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'warning',
          message: `Validation failed (attempt ${validationAttempts}/${maxValidationRetries}), re-running agent`,
          data: { output: validation.output.slice(0, 2000) },
        });

        context.validationErrors = validation.output;
        try {
          result = await agent.execute(context, config, wrappedOnOutput, onLog);
        } catch (err) {
          result = { exitCode: 1, output: err instanceof Error ? err.message : String(err), outcome: 'failed' };
        }
      }

      // Final validation check after retries exhausted
      if (validationAttempts === maxValidationRetries && validationCommands.length > 0 && result.exitCode === 0) {
        const finalCheck = await this.runValidation(validationCommands, worktree.path);
        if (!finalCheck.passed) {
          await this.taskEventLog.log({
            taskId,
            category: 'agent',
            severity: 'warning',
            message: `Validation still failing after ${maxValidationRetries} retries`,
            data: { output: finalCheck.output.slice(0, 2000) },
          });
        }
      }

      if (validationCommands.length > 0) {
        this.taskEventLog.log({
          taskId,
          category: 'agent_debug',
          severity: 'debug',
          message: `Validation complete: attempts=${validationAttempts}, passed=${validationAttempts < maxValidationRetries}`,
        }).catch(() => {});
      }

      // Stop periodic flushing and do a final flush with the complete result
      clearInterval(flushInterval);

      // Update run
      const completedAt = now();
      const runStatus = result.exitCode === 0 ? 'completed' : 'failed';
      await this.agentRunStore.updateRun(run.id, {
        status: runStatus,
        output: result.output,
        outcome: result.outcome,
        payload: result.payload,
        exitCode: result.exitCode,
        completedAt,
        costInputTokens: result.costInputTokens,
        costOutputTokens: result.costOutputTokens,
        prompt: result.prompt,
      });
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Agent run updated: status=${runStatus}, outcome=${result.outcome}, exitCode=${result.exitCode}`,
      }).catch(() => {});

      // Validate outcome payload
      if (result.outcome) {
        const validation = validateOutcomePayload(result.outcome, result.payload);
        if (!validation.valid) {
          await this.taskEventLog.log({
            taskId,
            category: 'agent',
            severity: 'warning',
            message: `Invalid outcome payload: ${validation.error}`,
            data: { outcome: result.outcome, error: validation.error },
          });
          // Don't block — still attempt transition (warn-and-proceed for v1)
        }
      }

      // Extract plan, subtasks, and context from plan/plan_revision output
      if (result.exitCode === 0 && (context.mode === 'plan' || context.mode === 'plan_revision' || context.mode === 'investigate')) {
        const so = result.structuredOutput as { plan?: string; planSummary?: string; investigationSummary?: string; subtasks?: string[] } | undefined;
        if (so?.plan) {
          this.taskEventLog.log({
            taskId,
            category: 'agent_debug',
            severity: 'debug',
            message: `Extracting plan from structured output: hasPlan=${!!so.plan}, hasSubtasks=${!!so.subtasks}, subtaskCount=${so.subtasks?.length ?? 0}`,
          }).catch(() => {});
          const updates: import('../../shared/types').TaskUpdateInput = { plan: so.plan };
          if (so.subtasks && so.subtasks.length > 0) {
            updates.subtasks = so.subtasks.map(name => ({ name, status: 'open' as const }));
          }
          await this.taskStore.updateTask(taskId, updates);
        } else {
          // Fallback: parse raw output if structured output unavailable
          this.taskEventLog.log({
            taskId,
            category: 'agent_debug',
            severity: 'debug',
            message: 'Structured output unavailable, falling back to raw output parsing',
          }).catch(() => {});
          await this.taskStore.updateTask(taskId, { plan: this.extractPlan(result.output) });
          try {
            const subtasks = this.extractSubtasks(result.output);
            if (subtasks.length > 0) {
              await this.taskStore.updateTask(taskId, { subtasks });
            }
          } catch {
            // Non-fatal
          }
        }
      }

      // Save context entry for successful runs
      if (result.exitCode === 0) {
        try {
          // Use structured output summary when available, fall back to parsing
          const so = result.structuredOutput as { summary?: string; planSummary?: string; investigationSummary?: string } | undefined;
          const structuredSummary = so?.investigationSummary ?? so?.planSummary ?? so?.summary;
          const summary = structuredSummary || this.extractContextSummary(result.output);
          const entryType = this.getContextEntryType(agentType, context.mode, result.outcome);
          this.taskEventLog.log({
            taskId,
            category: 'agent_debug',
            severity: 'debug',
            message: `Saving context entry: type=${entryType}, source=${agentType === 'pr-reviewer' ? 'reviewer' : 'agent'}, summaryLength=${summary.length}`,
          }).catch(() => {});
          const entryData: Record<string, unknown> = {};
          if (agentType === 'pr-reviewer') {
            entryData.verdict = result.outcome;
            if (result.payload?.comments) {
              entryData.comments = result.payload.comments;
            }
          }
          await this.taskContextStore.addEntry({
            taskId, agentRunId: run.id,
            source: agentType === 'pr-reviewer' ? 'reviewer' : 'agent',
            entryType, summary, data: entryData,
          });
        } catch (err) {
          // Non-fatal — don't block pipeline on context entry failure
          await this.taskEventLog.log({
            taskId,
            category: 'agent',
            severity: 'warning',
            message: `Failed to save context entry: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      // Handle outcome — all outcomes go through the generic transition path.
      // Side-effects (prompt creation, PR creation) are handled by hooks on the transition.
      if (result.exitCode === 0) {
        // Always create branch artifact for successful runs
        await this.taskArtifactStore.createArtifact({
          taskId,
          type: 'branch',
          data: { branch: worktree.branch },
        });
        await this.taskPhaseStore.updatePhase(phase.id, { status: 'completed', completedAt });

        // Guard: verify branch has actual changes before transitioning to pr_ready
        let effectiveOutcome: string | undefined = result.outcome;
        if (effectiveOutcome === 'pr_ready') {
          this.taskEventLog.log({
            taskId,
            category: 'agent_debug',
            severity: 'debug',
            message: `Verifying branch diff for pr_ready: branch=${worktree.branch}`,
          }).catch(() => {});
          try {
            const gitOps = this.createGitOps(worktree.path);
            const diffContent = await gitOps.diff('main', worktree.branch);
            this.taskEventLog.log({
              taskId,
              category: 'agent_debug',
              severity: 'debug',
              message: `Branch diff result: hasChanges=${diffContent.trim().length > 0}, diffLength=${diffContent.length}`,
            }).catch(() => {});
            if (diffContent.trim().length === 0) {
              await this.taskEventLog.log({
                taskId,
                category: 'agent',
                severity: 'warning',
                message: 'Agent reported pr_ready but no changes detected on branch — skipping transition',
                data: { branch: worktree.branch },
              });
              effectiveOutcome = undefined;
            }
          } catch (err) {
            await this.taskEventLog.log({
              taskId,
              category: 'agent',
              severity: 'warning',
              message: `Failed to verify branch diff: ${err instanceof Error ? err.message : String(err)}`,
              data: { branch: worktree.branch },
            });
          }
        }

        if (effectiveOutcome) {
          this.taskEventLog.log({
            taskId,
            category: 'agent_debug',
            severity: 'debug',
            message: `Attempting outcome transition: outcome=${effectiveOutcome}`,
          }).catch(() => {});
          await this.tryOutcomeTransition(taskId, effectiveOutcome, {
            agentRunId: run.id,
            payload: result.payload,
            branch: worktree.branch,
          });
        }
      } else {
        await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });
      }

      // Cleanup — unlock before retry transition so the new agent can acquire the lock
      await worktreeManager.unlock(taskId);
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'debug',
        message: 'Worktree unlocked',
        data: { taskId },
      });

      // For failed runs, attempt failure transition (pipeline may retry via hooks)
      if (result.exitCode !== 0) {
        await this.tryOutcomeTransition(taskId, 'failed', { agentRunId: run.id });
      }

      // Log completion event
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: result.exitCode === 0 ? 'info' : 'error',
        message: `Agent ${agentType} completed with outcome: ${result.outcome ?? 'none'}`,
        data: { agentRunId: run.id, exitCode: result.exitCode, outcome: result.outcome },
      });
    } catch (outerErr) {
      // FATAL: catch any unhandled error in post-agent processing to prevent silent hangs
      const errMsg = outerErr instanceof Error ? outerErr.message : String(outerErr);
      this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: 'error',
        message: `FATAL: Unhandled error in agent background execution: ${errMsg}`,
        data: { agentRunId: run.id, error: errMsg },
      }).catch(() => {});
      try {
        await this.agentRunStore.updateRun(run.id, {
          status: 'failed',
          outcome: 'failed',
          exitCode: 1,
          output: `Internal error: ${errMsg}`,
          completedAt: now(),
        });
      } catch {
        // Last resort — can't even update the run
      }
    } finally {
      clearInterval(flushInterval);
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Agent background execution cleanup: runId=${run.id}`,
      }).catch(() => {});
      this.backgroundPromises.delete(run.id);
    }
  }

  async waitForCompletion(runId: string): Promise<void> {
    const promise = this.backgroundPromises.get(runId);
    if (promise) {
      await promise;
    }
  }

  async stop(runId: string): Promise<void> {
    const run = await this.agentRunStore.getRun(runId);
    if (!run) throw new Error(`Agent run not found: ${runId}`);

    const agent = this.agentFramework.getAgent(run.agentType);
    await agent.stop(run.taskId);

    await this.agentRunStore.updateRun(runId, {
      status: 'cancelled',
      completedAt: now(),
    });

    await this.pendingPromptStore.expirePromptsForRun(runId);
  }

  private async runValidation(commands: string[], cwd: string): Promise<{ passed: boolean; output: string }> {
    const results: string[] = [];
    for (const cmd of commands) {
      try {
        await execAsync(cmd, { cwd, env: getShellEnv(), timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
      } catch (err: any) {
        const exitCode = err.code ?? '?';
        results.push(`$ ${cmd} (exit ${exitCode})\n${err.stdout ?? ''}${err.stderr ?? ''}`);
      }
    }
    return results.length === 0
      ? { passed: true, output: '' }
      : { passed: false, output: results.join('\n\n') };
  }

  private extractPlan(output: string): string {
    // The raw output contains interleaved plan text, tool calls, and tool results.
    // Strip tool call lines ("> Tool: ...", "> Input: ...") and
    // bracketed system messages ("[tool_result] ...", "[system] ...", etc.)
    return output
      .split('\n')
      .filter(line => {
        if (line.startsWith('> Tool: ') || line.startsWith('> Input: ')) return false;
        if (/^\[[\w_]+\] /.test(line)) return false;
        return true;
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private extractContextSummary(output: string): string {
    const trimmed = output.trimEnd();
    const match = trimmed.match(/## Summary\s*\n([\s\S]+)$/i);
    if (match) return match[1].trim().slice(0, 2000);
    return trimmed.slice(-500).trim();
  }

  private getContextEntryType(agentType: string, mode: AgentMode, outcome?: string): string {
    if (agentType === 'pr-reviewer') return outcome === 'approved' ? 'review_approved' : 'review_feedback';
    switch (mode) {
      case 'plan': return 'plan_summary';
      case 'plan_revision': return 'plan_revision_summary';
      case 'investigate': return 'investigation_summary';
      case 'implement': return 'implementation_summary';
      case 'request_changes': return 'fix_summary';
      default: return 'agent_output';
    }
  }

  private extractSubtasks(output: string): import('../../shared/types').Subtask[] {
    const match = output.match(/## Subtasks\s*\n[\s\S]*?```(?:json)?\s*\n([\s\S]*?)```/i);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        const results: import('../../shared/types').Subtask[] = [];
        for (const item of parsed) {
          if (typeof item === 'string') {
            results.push({ name: item, status: 'open' });
          } else if (typeof item === 'object' && item !== null && 'name' in item) {
            results.push({ name: String((item as { name: unknown }).name), status: 'open' });
          }
        }
        return results;
      }
    } catch {
      // Invalid JSON
    }
    return [];
  }

  private resolvePromptTemplate(template: string, context: AgentContext): string {
    const { task } = context;
    const desc = task.description ? ` ${task.description}` : '';

    // Build subtasks section
    let subtasksSection = '';
    if (context.mode === 'plan' || context.mode === 'investigate') {
      subtasksSection = [
        '',
        'At the end of your plan, include a "## Subtasks" section with a JSON array of subtask names that break down the implementation into concrete steps. Example:',
        '## Subtasks',
        '```json',
        '["Set up database schema", "Implement API endpoint", "Add unit tests"]',
        '```',
      ].join('\n');
    } else if (task.subtasks && task.subtasks.length > 0) {
      const lines = ['', '## Subtasks', 'Track your progress by updating subtask status as you work:'];
      for (const st of task.subtasks) {
        lines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
      }
      lines.push(
        '',
        'Use the CLI to update subtask status as you complete each step:',
        `  am tasks subtask update ${task.id} --name "subtask name" --status in_progress`,
        `  am tasks subtask update ${task.id} --name "subtask name" --status done`,
      );
      subtasksSection = lines.join('\n');
    }

    // Build plan section
    let planSection = '';
    if (task.plan) {
      planSection = `\n## Plan\n${task.plan}`;
    }

    // Build prior review section
    let priorReviewSection = '';
    const hasPriorReview = context.taskContext?.some(
      e => e.entryType === 'review_feedback' || e.entryType === 'fix_summary'
    );
    if (hasPriorReview) {
      priorReviewSection = [
        'This is a RE-REVIEW. Previous review feedback and fixes are in the Task Context above.',
        'Verify ALL previously requested changes were addressed before approving.',
        '',
      ].join('\n');
    }

    // Build plan comments section
    let planCommentsSection = '';
    if (task.planComments && task.planComments.length > 0) {
      const lines = ['', '## Admin Feedback'];
      for (const comment of task.planComments) {
        const time = new Date(comment.createdAt).toLocaleString();
        lines.push(`- **${comment.author}** (${time}): ${comment.content}`);
      }
      planCommentsSection = lines.join('\n');
    }

    // Build related task section for bug reports
    let relatedTaskSection = '';
    const relatedTaskId = task.metadata?.relatedTaskId as string | undefined;
    if (relatedTaskId) {
      relatedTaskSection = [
        '',
        '## Related Task',
        `This bug references task \`${relatedTaskId}\`. Use the CLI to inspect it:`,
        `  am tasks get ${relatedTaskId} --json`,
        `  am events list --task ${relatedTaskId} --json`,
      ].join('\n');
    }

    // Use replacer functions to avoid $-pattern interpretation in replacement strings
    let prompt = template
      .replace(/\{taskTitle\}/g, () => task.title)
      .replace(/\{taskDescription\}/g, () => desc)
      .replace(/\{taskId\}/g, () => task.id)
      .replace(/\{subtasksSection\}/g, () => subtasksSection)
      .replace(/\{planSection\}/g, () => planSection)
      .replace(/\{planCommentsSection\}/g, () => planCommentsSection)
      .replace(/\{priorReviewSection\}/g, () => priorReviewSection)
      .replace(/\{relatedTaskSection\}/g, () => relatedTaskSection);

    // Append standard suffix
    prompt += '\n\nWhen you are done, end your response with a "## Summary" section that briefly describes what you did.';

    // Append validation errors if present
    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  private async tryOutcomeTransition(taskId: string, outcome: string, data?: Record<string, unknown>): Promise<void> {
    this.taskEventLog.log({
      taskId,
      category: 'agent_debug',
      severity: 'debug',
      message: `tryOutcomeTransition: taskId=${taskId}, outcome=${outcome}`,
    }).catch(() => {});

    const task = await this.taskStore.getTask(taskId);
    if (!task) return;

    const transitions = await this.pipelineEngine.getValidTransitions(task, 'agent');
    const match = transitions.find((t) => t.agentOutcome === outcome);
    if (match) {
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Found matching transition: ${task.status} → ${match.to}`,
      }).catch(() => {});
      const ctx: TransitionContext = { trigger: 'agent', data: { outcome, ...data } };
      const result = await this.pipelineEngine.executeTransition(task, match.to, ctx);
      if (result.success) {
        this.taskEventLog.log({
          taskId,
          category: 'agent_debug',
          severity: 'debug',
          message: `Outcome transition succeeded: ${task.status} → ${match.to}`,
        }).catch(() => {});
      } else {
        await this.taskEventLog.log({
          taskId,
          category: 'system',
          severity: 'warning',
          message: `Outcome transition "${outcome}" to "${match.to}" failed: ${result.error ?? result.guardFailures?.map((g) => g.reason).join(', ')}`,
          data: { outcome, toStatus: match.to, error: result.error, guardFailures: result.guardFailures },
        });
      }
    } else {
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `No matching transition found for outcome=${outcome} from status=${task.status}`,
      }).catch(() => {});
    }
  }

}
