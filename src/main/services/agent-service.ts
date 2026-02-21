import type {
  AgentRun,
  AgentMode,
  AgentContext,
  AgentConfig,
  TransitionContext,
  AgentChatMessage,
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
import type { INotificationRouter } from '../interfaces/notification-router';
import type { TaskReviewReportBuilder } from './task-review-report-builder';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { validateOutcomePayload } from '../handlers/outcome-schemas';
import { now } from '../stores/utils';
import { getShellEnv } from './shell-env';
import { getActivePhase, getActivePhaseIndex, isMultiPhase } from '../../shared/phase-utils';

const execAsync = promisify(exec);

export class AgentService implements IAgentService {
  private backgroundPromises = new Map<string, Promise<void>>();
  private messageQueues = new Map<string, string[]>();
  private activeCallbacks = new Map<string, { onOutput?: (chunk: string) => void; onMessage?: (msg: AgentChatMessage) => void; onStatusChange?: (status: string) => void }>();

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
    private taskReviewReportBuilder?: TaskReviewReportBuilder,
    private notificationRouter?: INotificationRouter,
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

  queueMessage(taskId: string, message: string): void {
    const queue = this.messageQueues.get(taskId) || [];
    queue.push(message);
    this.messageQueues.set(taskId, queue);
  }

  async execute(taskId: string, mode: AgentMode, agentType: string, onOutput?: (chunk: string) => void, onMessage?: (msg: AgentChatMessage) => void, onStatusChange?: (status: string) => void): Promise<AgentRun> {
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
      // Phase-aware branch naming: append /phase-{n} for multi-phase tasks
      let branch = `task/${taskId}/${mode}`;
      if (isMultiPhase(task)) {
        const phaseIdx = getActivePhaseIndex(task.phases);
        if (phaseIdx >= 0) {
          branch = `task/${taskId}/implement/phase-${phaseIdx + 1}`;
        }
      }
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
      // Skip rebase for resolve_conflicts — the agent handles rebase itself.
      await gitOps.fetch('origin');
      if (mode === 'resolve_conflicts') {
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'info',
          message: 'Skipping pre-agent rebase for resolve_conflicts mode (agent will rebase)',
          data: { taskId },
        });
      } else try {
        await gitOps.rebase('origin/main');
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'info',
          message: 'Worktree rebased onto origin/main',
          data: { taskId },
        });
      } catch (rebaseErr) {
        // Abort the broken rebase so the worktree is left in a usable state
        try { await gitOps.rebaseAbort(); } catch { /* may not be in rebase state */ }
        const errorMsg = rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr);
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'warning',
          message: `Rebase failed and aborted: ${errorMsg}`,
          data: { taskId, error: errorMsg },
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'warning',
        message: `Worktree clean failed: ${errorMsg}`,
        data: { taskId, error: errorMsg },
      });
    }

    // Build review report file in the worktree for the workflow reviewer
    if (agentType === 'task-workflow-reviewer' && this.taskReviewReportBuilder) {
      try {
        const reportPath = path.join(worktree.path, '.task-review-report.txt');
        await this.taskReviewReportBuilder.buildReport(taskId, reportPath);
        await this.taskEventLog.log({
          taskId, category: 'agent_debug', severity: 'debug',
          message: `Review report written to ${reportPath}`,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.taskEventLog.log({
          taskId, category: 'agent', severity: 'warning',
          message: `Failed to build review report: ${errorMsg}`,
          data: { error: errorMsg },
        });
      }
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
    // Consume any queued message as customPrompt
    const queue = this.messageQueues.get(taskId);
    const customPrompt = queue && queue.length > 0 ? queue.shift() : undefined;
    if (queue && queue.length === 0) this.messageQueues.delete(taskId);

    const context: AgentContext = {
      task,
      project,
      workdir: worktree.path,
      mode,
      customPrompt,
    };

    // Load accumulated task context entries for the agent
    context.taskContext = await this.taskContextStore.getEntriesForTask(taskId);

    // Look up agent definition by convention-based ID and pass modeConfig to context
    try {
      const defId = `agent-def-${agentType}`;
      const agentDef = await this.agentDefinitionStore.getDefinition(defId);
      if (agentDef) {
        const modeConfig = agentDef.modes.find(m => m.mode === mode);
        if (modeConfig) {
          context.modeConfig = modeConfig;
        }
        if (agentDef.skills.length > 0) {
          context.skills = agentDef.skills;
        }
      }
    } catch {
      // Fall through to hardcoded buildPrompt if lookup fails
    }

    const config: AgentConfig = {
      model: context.project.config?.model as string | undefined,
    };

    // 7. Store active callbacks for this task
    this.activeCallbacks.set(taskId, { onOutput, onMessage, onStatusChange });

    // 8. Fire-and-forget agent execution in background
    const agent = this.agentFramework.getAgent(agentType);
    const promise = this.runAgentInBackground(agent, context, config, run, task, phase, worktree, worktreeManager, agentType, onOutput, onMessage, onStatusChange);
    this.backgroundPromises.set(run.id, promise);

    // 9. Return run immediately (status: 'running')
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
    onMessage?: (msg: AgentChatMessage) => void,
    onStatusChange?: (status: string) => void,
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

    // Buffer output and periodically flush to DB so it survives page refreshes.
    // Cap the buffer to prevent unbounded memory growth.
    const MAX_OUTPUT_BUFFER = 5 * 1024 * 1024; // 5 MB
    let outputBuffer = '';
    const wrappedOnOutput = onOutput
      ? (chunk: string) => {
          if (outputBuffer.length < MAX_OUTPUT_BUFFER) {
            outputBuffer += chunk;
            if (outputBuffer.length > MAX_OUTPUT_BUFFER) {
              outputBuffer = outputBuffer.slice(0, MAX_OUTPUT_BUFFER) + '\n[output truncated]';
            }
          }
          onOutput(chunk);
        }
      : undefined;
    let metadataFlushed = false;
    let flushErrorCount = 0;
    const flushInterval = setInterval(() => {
      const flushData: import('../../shared/types').AgentRunUpdateInput = {};
      if (outputBuffer) {
        flushData.output = outputBuffer;
      }
      // Flush live cost and progress data from agent
      const agentAny = agent as { accumulatedInputTokens?: number; accumulatedOutputTokens?: number; lastMessageCount?: number; lastTimeout?: number; lastMaxTurns?: number };
      if (agentAny.accumulatedInputTokens != null && agentAny.accumulatedInputTokens > 0) flushData.costInputTokens = agentAny.accumulatedInputTokens;
      if (agentAny.accumulatedOutputTokens != null && agentAny.accumulatedOutputTokens > 0) flushData.costOutputTokens = agentAny.accumulatedOutputTokens;
      if (agentAny.lastMessageCount != null && agentAny.lastMessageCount > 0) flushData.messageCount = agentAny.lastMessageCount;
      // Flush timeout/maxTurns once
      if (!metadataFlushed) {
        if (agentAny.lastTimeout != null) flushData.timeoutMs = agentAny.lastTimeout;
        if (agentAny.lastMaxTurns != null) flushData.maxTurns = agentAny.lastMaxTurns;
        if (agentAny.lastTimeout != null || agentAny.lastMaxTurns != null) metadataFlushed = true;
      }
      if (Object.keys(flushData).length > 0) {
        this.agentRunStore.updateRun(run.id, flushData).catch((err) => {
          flushErrorCount++;
          if (flushErrorCount === 1 || flushErrorCount % 10 === 0) {
            onLog(`Flush to DB failed (count=${flushErrorCount}): ${err instanceof Error ? err.message : String(err)}`);
          }
        });
      }
    }, 3000);

    const onPromptBuilt = (prompt: string) => {
      this.agentRunStore.updateRun(run.id, { prompt }).catch(() => {});
    };

    // Wrap onMessage to intercept TodoWrite/Task tool_use events for subtask sync
    // Phase-aware: use active phase's subtasks when multi-phase
    const activePhaseForSync = getActivePhase(task.phases);
    const activePhaseIdxForSync = getActivePhaseIndex(task.phases);
    const effectiveSubtasks = (isMultiPhase(task) && activePhaseForSync) ? activePhaseForSync.subtasks : task.subtasks;
    const hasSubtaskTracking = (context.mode === 'implement' || context.mode === 'implement_resume' || context.mode === 'request_changes') && effectiveSubtasks && effectiveSubtasks.length > 0;
    const currentSubtasks = hasSubtaskTracking ? [...effectiveSubtasks] : [];
    const sdkTaskIdToSubtaskName = new Map<string, string>();

    // Helper to persist subtask changes — writes to phase subtasks when multi-phase
    const persistSubtaskChanges = () => {
      if (isMultiPhase(task) && activePhaseIdxForSync >= 0 && task.phases) {
        if (activePhaseIdxForSync >= task.phases.length) {
          onLog(`persistSubtaskChanges: phase index ${activePhaseIdxForSync} out of bounds (${task.phases.length} phases)`);
          return this.taskStore.updateTask(taskId, { subtasks: [...currentSubtasks] });
        }
        const updatedPhases = [...task.phases];
        updatedPhases[activePhaseIdxForSync] = {
          ...updatedPhases[activePhaseIdxForSync],
          subtasks: [...currentSubtasks],
        };
        return this.taskStore.updateTask(taskId, { phases: updatedPhases });
      }
      return this.taskStore.updateTask(taskId, { subtasks: [...currentSubtasks] });
    };

    const mapSdkStatus = (sdkStatus: string): import('../../shared/types').SubtaskStatus | null => {
      switch (sdkStatus) {
        case 'pending': return 'open';
        case 'in_progress': return 'in_progress';
        case 'completed': return 'done';
        default: return null;
      }
    };

    const wrappedOnMessage = hasSubtaskTracking
      ? (msg: AgentChatMessage) => {
          if (msg.type === 'tool_use') {
            try {
              if (msg.toolName === 'TodoWrite') {
                const parsed = JSON.parse(msg.input);
                const todos: Array<{ content?: string; subject?: string; status?: string }> = parsed.todos ?? parsed;
                if (Array.isArray(todos)) {
                  let changed = false;
                  for (const todo of todos) {
                    const todoName = (todo.content ?? todo.subject ?? '').trim().toLowerCase();
                    const mappedStatus = mapSdkStatus(todo.status ?? '');
                    if (!todoName || !mappedStatus) continue;
                    const idx = currentSubtasks.findIndex(s => s.name.trim().toLowerCase() === todoName);
                    if (idx !== -1 && currentSubtasks[idx].status !== mappedStatus) {
                      currentSubtasks[idx] = { ...currentSubtasks[idx], status: mappedStatus };
                      changed = true;
                    }
                  }
                  if (changed) {
                    persistSubtaskChanges().catch((err) => {
                      onLog(`Failed to persist subtask sync: ${err instanceof Error ? err.message : String(err)}`);
                    });
                  }
                }
              } else if (msg.toolName === 'TaskCreate') {
                const parsed = JSON.parse(msg.input);
                const subject = (parsed.subject ?? parsed.description ?? '').trim().toLowerCase();
                const match = currentSubtasks.find(s => s.name.trim().toLowerCase() === subject);
                if (match && msg.toolId) {
                  sdkTaskIdToSubtaskName.set(msg.toolId, match.name);
                }
              } else if (msg.toolName === 'TaskUpdate') {
                const parsed = JSON.parse(msg.input);
                const sdkTaskId = parsed.taskId ?? parsed.id ?? '';
                const subtaskName = sdkTaskIdToSubtaskName.get(sdkTaskId);
                if (subtaskName) {
                  const mappedStatus = mapSdkStatus(parsed.status ?? '');
                  if (mappedStatus) {
                    const idx = currentSubtasks.findIndex(s => s.name === subtaskName);
                    if (idx !== -1 && currentSubtasks[idx].status !== mappedStatus) {
                      currentSubtasks[idx] = { ...currentSubtasks[idx], status: mappedStatus };
                      persistSubtaskChanges().catch((err) => {
                        onLog(`Failed to persist subtask sync: ${err instanceof Error ? err.message : String(err)}`);
                      });
                    }
                  }
                }
              }
            } catch (err) {
              onLog(`Subtask sync error: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          onMessage?.(msg);
        }
      : onMessage;

    let result: import('../../shared/types').AgentRunResult | undefined;
    try {
      try {
        result = await agent.execute(context, config, wrappedOnOutput, onLog, onPromptBuilt, wrappedOnMessage);
      } catch (err) {
        clearInterval(flushInterval);
        const errorMsg = err instanceof Error ? err.message : String(err);
        const completedAt = now();
        // Recover partial cost data from agent if available
        const partialInputTokens = 'lastCostInputTokens' in agent ? (agent as { lastCostInputTokens?: number }).lastCostInputTokens : undefined;
        const partialOutputTokens = 'lastCostOutputTokens' in agent ? (agent as { lastCostOutputTokens?: number }).lastCostOutputTokens : undefined;
        const partialMessageCount = 'lastMessageCount' in agent ? (agent as { lastMessageCount?: number }).lastMessageCount : undefined;
        await this.agentRunStore.updateRun(run.id, {
          status: 'failed',
          output: errorMsg,
          error: errorMsg,
          outcome: 'failed',
          exitCode: 1,
          completedAt,
          costInputTokens: partialInputTokens,
          costOutputTokens: partialOutputTokens,
          messageCount: partialMessageCount,
        });
        await this.taskPhaseStore.updatePhase(phase.id, { status: 'failed', completedAt });
        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'error',
          message: `Agent ${agentType} failed: ${errorMsg}`,
          data: { agentRunId: run.id, error: errorMsg },
        });
        try {
          await worktreeManager.unlock(taskId);
          await this.taskEventLog.log({
            taskId,
            category: 'worktree',
            severity: 'debug',
            message: 'Worktree unlocked',
            data: { taskId },
          });
        } catch {
          // Worktree may have been deleted by a transition hook — safe to ignore
        }

        // Attempt failure transition (pipeline may retry via hooks)
        await this.tryOutcomeTransition(taskId, 'failed', { agentRunId: run.id });
        return;
      }

      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Agent execute() returned: exitCode=${result.exitCode}, outcome=${result.outcome}, outputLength=${result.output?.length ?? 0}, costTokens=${result.costInputTokens ?? 0}/${result.costOutputTokens ?? 0}, hasStructuredOutput=${!!result.structuredOutput}${result.error ? `, error=${result.error}` : ''}`,
        data: { exitCode: result.exitCode, outcome: result.outcome, outputLength: result.output?.length ?? 0, ...(result.error ? { error: result.error } : {}) },
      }).catch(() => {});

      // Post-agent validation loop (skip for plan/plan_revision/investigate/technical_design modes — no code changes to validate)
      const validationCommands = context.mode !== 'plan' && context.mode !== 'plan_revision' && context.mode !== 'plan_resume'
        && context.mode !== 'investigate' && context.mode !== 'investigate_resume'
        && context.mode !== 'technical_design' && context.mode !== 'technical_design_revision' && context.mode !== 'technical_design_resume'
        ? (context.project.config?.validationCommands as string[] | undefined) ?? []
        : [];
      const maxValidationRetries = (context.project.config?.maxValidationRetries as number | undefined) ?? 3;
      let validationAttempts = 0;

      // Track accumulated costs across validation retries
      let accumulatedInputTokens = result.costInputTokens ?? 0;
      let accumulatedOutputTokens = result.costOutputTokens ?? 0;

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
          const retryPartialInput = 'lastCostInputTokens' in agent ? (agent as { lastCostInputTokens?: number }).lastCostInputTokens : undefined;
          const retryPartialOutput = 'lastCostOutputTokens' in agent ? (agent as { lastCostOutputTokens?: number }).lastCostOutputTokens : undefined;
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
      const finalMessageCount = 'lastMessageCount' in agent ? (agent as { lastMessageCount?: number }).lastMessageCount : undefined;
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
        error: result.error,
        messageCount: finalMessageCount,
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

      // Extract plan, subtasks, and context from plan/plan_revision/investigate output
      if (result.exitCode === 0 && (context.mode === 'plan' || context.mode === 'plan_revision' || context.mode === 'plan_resume' || context.mode === 'investigate' || context.mode === 'investigate_resume')) {
        const so = result.structuredOutput as { plan?: string; planSummary?: string; investigationSummary?: string; subtasks?: string[]; phases?: Array<{ name: string; subtasks: string[] }> } | undefined;
        if (so?.plan) {
          this.taskEventLog.log({
            taskId,
            category: 'agent_debug',
            severity: 'debug',
            message: `Extracting plan from structured output: hasPlan=${!!so.plan}, hasSubtasks=${!!so.subtasks}, subtaskCount=${so.subtasks?.length ?? 0}, hasPhases=${!!so.phases}, phaseCount=${so.phases?.length ?? 0}`,
          }).catch(() => {});
          const updates: import('../../shared/types').TaskUpdateInput = { plan: so.plan };
          // Check for multi-phase output
          if (so.phases && so.phases.length > 1) {
            const phases: import('../../shared/types').ImplementationPhase[] = so.phases.map((p, idx) => ({
              id: `phase-${idx + 1}`,
              name: p.name,
              status: idx === 0 ? 'in_progress' as const : 'pending' as const,
              subtasks: p.subtasks.map(name => ({ name, status: 'open' as const })),
            }));
            updates.phases = phases;
            updates.subtasks = []; // subtasks live inside phases
            this.taskEventLog.log({
              taskId,
              category: 'agent_debug',
              severity: 'info',
              message: `Multi-phase plan created with ${phases.length} phases`,
              data: { phaseNames: phases.map(p => p.name) },
            }).catch(() => {});
          } else if (so.subtasks && so.subtasks.length > 0) {
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

      // Extract technical design from technical_design/technical_design_revision output
      if (result.exitCode === 0 && (context.mode === 'technical_design' || context.mode === 'technical_design_revision' || context.mode === 'technical_design_resume')) {
        const so = result.structuredOutput as { technicalDesign?: string; designSummary?: string; subtasks?: string[] } | undefined;
        if (so?.technicalDesign) {
          this.taskEventLog.log({
            taskId,
            category: 'agent_debug',
            severity: 'debug',
            message: `Extracting technical design from structured output: hasDesign=${!!so.technicalDesign}, hasSubtasks=${!!so.subtasks}, subtaskCount=${so.subtasks?.length ?? 0}`,
          }).catch(() => {});
          const updates: import('../../shared/types').TaskUpdateInput = { technicalDesign: so.technicalDesign };
          if (so.subtasks && so.subtasks.length > 0) {
            // During revision, only overwrite subtasks if none have been started yet
            if (context.mode === 'technical_design_revision') {
              const current = await this.taskStore.getTask(taskId);
              const allOpen = !current?.subtasks?.some(s => s.status !== 'open');
              if (allOpen) {
                updates.subtasks = so.subtasks.map(name => ({ name, status: 'open' as const }));
              } else {
                this.taskEventLog.log({
                  taskId,
                  category: 'agent_debug',
                  severity: 'debug',
                  message: 'Skipping subtask overwrite during revision — some subtasks already started',
                }).catch(() => {});
              }
            } else {
              updates.subtasks = so.subtasks.map(name => ({ name, status: 'open' as const }));
            }
          }
          await this.taskStore.updateTask(taskId, updates);
        } else {
          // Fallback: store raw output as technical design (only if non-empty to avoid overwriting valid design on bad runs)
          const fallback = this.extractPlan(result.output);
          if (fallback) {
            await this.taskStore.updateTask(taskId, { technicalDesign: fallback });
          }
        }
      }

      // Save context entry for successful runs
      if (result.exitCode === 0) {
        try {
          // Use structured output summary when available, fall back to parsing
          const so = result.structuredOutput as { summary?: string; planSummary?: string; investigationSummary?: string; designSummary?: string } | undefined;
          const structuredSummary = so?.investigationSummary ?? so?.designSummary ?? so?.planSummary ?? so?.summary;
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
          if (agentType === 'task-workflow-reviewer') {
            interface WorkflowReviewerOutput {
              overallVerdict?: string;
              findings?: unknown;
              codeImprovements?: unknown;
              processImprovements?: unknown;
              tokenCostAnalysis?: unknown;
              executionSummary?: unknown;
            }
            const so = result.structuredOutput as WorkflowReviewerOutput | undefined;
            entryData.verdict = so?.overallVerdict;
            entryData.findings = so?.findings;
            entryData.codeImprovements = so?.codeImprovements;
            entryData.processImprovements = so?.processImprovements;
            entryData.tokenCostAnalysis = so?.tokenCostAnalysis;
            entryData.executionSummary = so?.executionSummary;
          }
          const entrySource = agentType === 'pr-reviewer' ? 'reviewer'
            : agentType === 'task-workflow-reviewer' ? 'workflow-reviewer'
            : 'agent';
          await this.taskContextStore.addEntry({
            taskId, agentRunId: run.id,
            source: entrySource,
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
            const diffContent = await gitOps.diff('origin/main', worktree.branch);
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
                message: 'Agent reported pr_ready but no changes detected on branch — using no_changes outcome',
                data: { branch: worktree.branch },
              });
              effectiveOutcome = 'no_changes';
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

        // Early conflict detection: rebase check before transition
        // Skip for resolve_conflicts mode — the agent itself handles the rebase
        if (effectiveOutcome === 'pr_ready' && context.mode !== 'resolve_conflicts') {
          try {
            const gitOps = this.createGitOps(worktree.path);
            await gitOps.fetch('origin');
            await gitOps.rebase('origin/main');
            await this.taskEventLog.log({
              taskId,
              category: 'git',
              severity: 'info',
              message: 'Pre-transition rebase onto origin/main succeeded',
            });
          } catch {
            try {
              const gitOps = this.createGitOps(worktree.path);
              await gitOps.rebaseAbort();
            } catch { /* may not be in rebase state */ }
            await this.taskEventLog.log({
              taskId,
              category: 'git',
              severity: 'warning',
              message: 'Merge conflicts with origin/main detected — switching to conflicts_detected outcome',
              data: { branch: worktree.branch },
            });
            effectiveOutcome = 'conflicts_detected';
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

      // Cleanup — unlock before retry transition so the new agent can acquire the lock.
      // The worktree may already be deleted by hooks (e.g. advance_phase, merge_pr).
      try {
        await worktreeManager.unlock(taskId);
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'debug',
          message: 'Worktree unlocked',
          data: { taskId },
        });
      } catch {
        // Worktree may have been deleted by a transition hook — safe to ignore
      }

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
        data: {
          agentRunId: run.id,
          exitCode: result.exitCode,
          outcome: result.outcome,
          ...(result.error ? { error: result.error } : {}),
          costInputTokens: result.costInputTokens,
          costOutputTokens: result.costOutputTokens,
        },
      });

      // Emit status change
      const finalStatus = result.exitCode === 0 ? 'completed' : 'failed';
      onStatusChange?.(finalStatus);
      const statusMessage = result.error ? `Agent ${finalStatus}: ${result.error}` : `Agent ${finalStatus}`;
      onMessage?.({ type: 'status', status: finalStatus, message: statusMessage, timestamp: Date.now() });

      // Send native notification
      try {
        this.notificationRouter?.send({
          taskId,
          title: `Agent ${finalStatus}`,
          body: `${agentType} agent ${finalStatus} for task: ${task.title}`,
          channel: run.id,
        });
      } catch { /* notification failure is non-fatal */ }

      // Check message queue for follow-up messages
      const pendingQueue = this.messageQueues.get(taskId);
      if (pendingQueue && pendingQueue.length > 0) {
        try {
          const callbacks = this.activeCallbacks.get(taskId);
          await this.execute(taskId, context.mode, agentType, callbacks?.onOutput, callbacks?.onMessage, callbacks?.onStatusChange);
        } catch { /* queue processing failure is non-fatal */ }
      }
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
        const fatalMessageCount = 'lastMessageCount' in agent ? (agent as { lastMessageCount?: number }).lastMessageCount : undefined;
        await this.agentRunStore.updateRun(run.id, {
          status: 'failed',
          outcome: 'failed',
          exitCode: 1,
          output: `Internal error: ${errMsg}`,
          error: `Internal error: ${errMsg}`,
          completedAt: now(),
          costInputTokens: result?.costInputTokens,
          costOutputTokens: result?.costOutputTokens,
          messageCount: fatalMessageCount,
        });
      } catch {
        // Last resort — can't even update the run
      }
      // Notify UI even for fatal errors
      try {
        onStatusChange?.('failed');
        onMessage?.({ type: 'status', status: 'failed', message: `Internal error: ${errMsg}`, timestamp: Date.now() });
      } catch { /* notification failure is non-fatal in the fatal handler */ }
    } finally {
      // Delete the promise reference first to prevent leaks even if cleanup throws
      this.backgroundPromises.delete(run.id);
      clearInterval(flushInterval);
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Agent background execution cleanup: runId=${run.id}`,
      }).catch(() => {});
      // Clean up callbacks if no more queued messages
      if (!this.messageQueues.has(taskId)) {
        this.activeCallbacks.delete(taskId);
      }
    }
  }

  getActiveRunIds(): string[] {
    return Array.from(this.backgroundPromises.keys());
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

    // Clear any queued messages to prevent stale messages from being sent on future runs
    this.messageQueues.delete(run.taskId);
    this.activeCallbacks.delete(run.taskId);

    await this.agentRunStore.updateRun(runId, {
      status: 'cancelled',
      completedAt: now(),
    });

    await this.pendingPromptStore.expirePromptsForRun(runId);

    // Unlock worktree so subsequent runs can acquire it
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
    if (agentType === 'task-workflow-reviewer') return 'workflow_review';
    if (agentType === 'pr-reviewer') return outcome === 'approved' ? 'review_approved' : 'review_feedback';
    switch (mode) {
      case 'plan': return 'plan_summary';
      case 'plan_revision': return 'plan_revision_summary';
      case 'plan_resume': return 'plan_summary';
      case 'investigate': return 'investigation_summary';
      case 'investigate_resume': return 'investigation_summary';
      case 'implement': return 'implementation_summary';
      case 'implement_resume': return 'implementation_summary';
      case 'request_changes': return 'fix_summary';
      case 'resolve_conflicts': return 'conflict_resolution_summary';
      case 'technical_design': return 'technical_design_summary';
      case 'technical_design_revision': return 'technical_design_revision_summary';
      case 'technical_design_resume': return 'technical_design_summary';
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
