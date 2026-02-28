import type {
  AgentRun,
  AgentMode,
  RevisionReason,
  AgentContext,
  AgentConfig,
  AgentChatMessage,
} from '../../shared/types';
import type { IAgentFramework } from '../interfaces/agent-framework';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { ITaskStore } from '../interfaces/task-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { ITaskPhaseStore } from '../interfaces/task-phase-store';
import type { IPendingPromptStore } from '../interfaces/pending-prompt-store';
import type { IAgentService } from '../interfaces/agent-service';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { IAgentDefinitionStore } from '../interfaces/agent-definition-store';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { TaskReviewReportBuilder } from './task-review-report-builder';
import type { IAgent } from '../interfaces/agent';
import { ValidationRunner } from './validation-runner';
import type { OutcomeResolver } from './outcome-resolver';
import * as path from 'path';
import { validateOutcomePayload } from '../handlers/outcome-schemas';
import { now } from '../stores/utils';
import { getActivePhase, getActivePhaseIndex, isMultiPhase } from '../../shared/phase-utils';
import { SubtaskSyncInterceptor } from './subtask-sync-interceptor';
import { AgentOutputFlusher } from './agent-output-flusher';
import { PostRunExtractor } from './post-run-extractor';

export class AgentService implements IAgentService {
  private backgroundPromises = new Map<string, Promise<void>>();
  private messageQueues = new Map<string, string[]>();
  private activeCallbacks = new Map<string, { onOutput?: (chunk: string) => void; onMessage?: (msg: AgentChatMessage) => void; onStatusChange?: (status: string) => void }>();
  private runningAgents = new Map<string, IAgent>();
  /** Run IDs that have a DB record but are still in the setup phase (before backgroundPromises registration).
   *  Prevents the supervisor from falsely flagging them as ghost runs during slow setup (worktree, git ops, etc.). */
  private initializingRunIds = new Set<string>();
  private spawningTasks = new Set<string>();
  private readonly postRunExtractor: PostRunExtractor;

  constructor(
    private agentFramework: IAgentFramework,
    private agentRunStore: IAgentRunStore,
    private createWorktreeManager: (projectPath: string) => IWorktreeManager,
    private taskStore: ITaskStore,
    private projectStore: IProjectStore,
    private taskEventLog: ITaskEventLog,
    private taskPhaseStore: ITaskPhaseStore,
    private pendingPromptStore: IPendingPromptStore,
    private createGitOps: (cwd: string) => import('../interfaces/git-ops').IGitOps,
    private taskContextStore: ITaskContextStore,
    private agentDefinitionStore: IAgentDefinitionStore,
    private taskReviewReportBuilder: TaskReviewReportBuilder | undefined,
    private notificationRouter: INotificationRouter,
    private validationRunner: ValidationRunner,
    private outcomeResolver: OutcomeResolver,
  ) {
    this.postRunExtractor = new PostRunExtractor(this.taskStore, this.taskContextStore, this.taskEventLog);
  }

  async recoverOrphanedRuns(): Promise<AgentRun[]> {
    const activeRuns = await this.agentRunStore.getActiveRuns();
    if (activeRuns.length === 0) return [];

    const recovered: AgentRun[] = [];

    for (const run of activeRuns) {
      try {
        const completedAt = now();

        // Mark run as failed/interrupted
        const shutdownMsg: AgentChatMessage = { type: 'status', status: 'failed', message: 'Interrupted by app shutdown', timestamp: completedAt };
        const recoveredMessages = [...(run.messages ?? []), shutdownMsg];
        await this.agentRunStore.updateRun(run.id, {
          status: 'failed',
          outcome: 'interrupted',
          completedAt,
          output: (run.output ?? '') + '\n[Interrupted by app shutdown]',
          messages: recoveredMessages,
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
        } catch (err) {
          const unlockMsg = err instanceof Error ? err.message : String(err);
          await this.taskEventLog.log({
            taskId: run.taskId,
            category: 'worktree',
            severity: 'warning',
            message: `recoverOrphanedRuns: worktree unlock failed: ${unlockMsg}`,
            data: { error: unlockMsg },
          });
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

  async execute(taskId: string, mode: AgentMode, agentType: string, revisionReason?: RevisionReason, onOutput?: (chunk: string) => void, onMessage?: (msg: AgentChatMessage) => void, onStatusChange?: (status: string) => void): Promise<AgentRun> {
    // Pre-spawn guard: prevent duplicate agent launches for the same task
    if (this.spawningTasks.has(taskId)) {
      throw new Error(`Agent already spawning for task ${taskId} — duplicate launch prevented`);
    }
    this.spawningTasks.add(taskId);

    // 1. Fetch task + project
    const task = await this.taskStore.getTask(taskId);
    if (!task) { this.spawningTasks.delete(taskId); throw new Error(`Task not found: ${taskId}`); }

    const project = await this.projectStore.getProject(task.projectId);
    if (!project) { this.spawningTasks.delete(taskId); throw new Error(`Project not found: ${task.projectId}`); }

    const projectPath = project.path;
    if (!projectPath) { this.spawningTasks.delete(taskId); throw new Error(`Project ${project.id} has no path configured`); }

    let run: AgentRun | undefined;
    try {
    const worktreeManager = this.createWorktreeManager(projectPath);

    // 2. Create agent run record
    run = await this.agentRunStore.createRun({ taskId, agentType, mode });
    // Register immediately so the supervisor doesn't flag this as a ghost during setup.
    // The setup steps (worktree creation, git fetch/rebase) can take seconds to minutes,
    // creating a window where the DB says 'running' but backgroundPromises has no entry yet.
    this.initializingRunIds.add(run.id);
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
      let branch = `task/${taskId}/${agentType}`;
      if (isMultiPhase(task)) {
        const phaseIdx = getActivePhaseIndex(task.phases);
        if (phaseIdx >= 0) {
          branch = `task/${taskId}/${agentType}/phase-${phaseIdx + 1}`;
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

      // Fetch and best-effort rebase onto origin/main so the agent starts from
      // the latest main. If the rebase fails (e.g. prior commits conflict), the
      // agent's own rebase step (in the prompt) will handle conflict resolution.
      // Skip for resolve_conflicts — the agent handles the entire rebase itself,
      // and the pre-agent rebase would predictably fail (that's why we're here).
      await gitOps.fetch('origin');
      if (revisionReason === 'conflicts_detected') {
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'info',
          message: 'Skipping pre-agent rebase for conflicts_detected (agent will rebase)',
          data: { taskId },
        });
      } else {
        try {
          await gitOps.rebase('origin/main');
          await this.taskEventLog.log({
            taskId,
            category: 'worktree',
            severity: 'info',
            message: 'Worktree rebased onto origin/main',
            data: { taskId },
          });
        } catch (rebaseErr) {
          try { await gitOps.rebaseAbort(); } catch { /* may not be in rebase state */ }
          await this.taskEventLog.log({
            taskId,
            category: 'worktree',
            severity: 'warning',
            message: `Pre-agent rebase failed (agent will handle conflicts): ${rebaseErr instanceof Error ? rebaseErr.message : String(rebaseErr)}`,
            data: { taskId },
          });
        }
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
      revisionReason,
      customPrompt,
    };

    // Load accumulated task context entries for the agent
    context.taskContext = await this.taskContextStore.getEntriesForTask(taskId);

    // Look up agent definition by convention-based ID and pass modeConfig to context
    const projectDefaultEngine = context.project.config?.defaultAgentLib as string | undefined;
    let agentDefEngine = projectDefaultEngine || 'claude-code';
    let agentDefModel: string | undefined;
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
        if (agentDef.engine) {
          agentDefEngine = agentDef.engine;
        }
        agentDefModel = agentDef.model ?? undefined;
      }
    } catch {
      // Fall through to hardcoded buildPrompt if lookup fails
    }

    const config: AgentConfig = {
      model: agentDefModel || (context.project.config?.defaultAgentLibModel as string | undefined),
      engine: agentDefEngine,
    };

    // 7. Store active callbacks for this task
    this.activeCallbacks.set(taskId, { onOutput, onMessage, onStatusChange });

    // 8. Resolve agent from framework — Agent resolves its lib internally via config.engine
    const agent = this.agentFramework.getAgent(agentType);
    this.runningAgents.set(taskId, agent);

    const promise = this.runAgentInBackground(agent, context, config, run, task, phase, worktree, worktreeManager, agentType, onOutput, onMessage, onStatusChange);
    this.backgroundPromises.set(run.id, promise);
    // Setup complete — now tracked by backgroundPromises, no longer needs initializing guard
    this.initializingRunIds.delete(run.id);

    // 9. Return run immediately (status: 'running')
    return run;
    } catch (err) {
      // Setup failed before the agent could start — remove from initializing set
      // so the supervisor can detect the orphaned DB record as a ghost.
      if (run) { this.initializingRunIds.delete(run.id); }
      // Release spawn lock if execute() fails before reaching runAgentInBackground()
      this.spawningTasks.delete(taskId);
      throw err;
    }
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

    // --- Output flusher: buffers output/messages and flushes to DB periodically ---
    const flusher = new AgentOutputFlusher(this.agentRunStore, run.id, agent, (msg) => onLog(msg));
    flusher.start();

    const wrappedOnOutput = onOutput
      ? (chunk: string) => {
          flusher.appendOutput(chunk);
          onOutput(chunk);
        }
      : undefined;

    const onPromptBuilt = (prompt: string) => {
      this.agentRunStore.updateRun(run.id, { prompt }).catch(() => {});
    };

    // --- Subtask sync interceptor: intercepts tool_use events to sync subtask status ---
    const activePhaseForSync = getActivePhase(task.phases);
    const activePhaseIdxForSync = getActivePhaseIndex(task.phases);
    const effectiveSubtasks = (isMultiPhase(task) && activePhaseForSync) ? activePhaseForSync.subtasks : task.subtasks;
    const hasSubtaskTracking = agentType === 'implementor' && effectiveSubtasks && effectiveSubtasks.length > 0;

    const subtaskInterceptor = hasSubtaskTracking
      ? new SubtaskSyncInterceptor(
          this.taskStore,
          taskId,
          task.phases,
          activePhaseIdxForSync,
          isMultiPhase(task),
          effectiveSubtasks,
          (msg) => onLog(msg),
        )
      : null;

    // Compose the onMessage pipeline: subtask sync -> buffer -> forward to caller
    const wrappedOnMessage = (msg: AgentChatMessage) => {
      subtaskInterceptor?.handleMessage(msg);
      flusher.appendMessage(msg);
      onMessage?.(msg);
    };

    let result: import('../../shared/types').AgentRunResult | undefined;
    try {
      try {
        result = await agent.execute(context, config, wrappedOnOutput, onLog, onPromptBuilt, wrappedOnMessage);
      } catch (err) {
        flusher.stop();
        const errorMsg = err instanceof Error ? err.message : String(err);
        const completedAt = now();
        // Recover partial cost data from agent telemetry if available
        const partialInputTokens = 'accumulatedInputTokens' in agent ? (agent as { accumulatedInputTokens?: number }).accumulatedInputTokens : undefined;
        const partialOutputTokens = 'accumulatedOutputTokens' in agent ? (agent as { accumulatedOutputTokens?: number }).accumulatedOutputTokens : undefined;
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
        await this.outcomeResolver.tryOutcomeTransition(taskId, 'failed', { agentRunId: run.id });
        return;
      }

      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Agent execute() returned: exitCode=${result.exitCode}, outcome=${result.outcome}, outputLength=${result.output?.length ?? 0}, costTokens=${result.costInputTokens ?? 0}/${result.costOutputTokens ?? 0}, hasStructuredOutput=${!!result.structuredOutput}${result.error ? `, error=${result.error}` : ''}`,
        data: { exitCode: result.exitCode, outcome: result.outcome, outputLength: result.output?.length ?? 0, ...(result.error ? { error: result.error } : {}) },
      }).catch(() => {});

      // Post-agent validation loop
      const validationCommands = ValidationRunner.getValidationCommands(agentType, context.project.config);
      const maxValidationRetries = (context.project.config?.maxValidationRetries as number | undefined) ?? 3;

      if (validationCommands.length > 0) {
        result = await this.validationRunner.runWithRetries({
          agent, context, config, run, taskId,
          validationCommands, maxRetries: maxValidationRetries,
          initialResult: result,
          wrappedOnOutput, onLog, onPromptBuilt, wrappedOnMessage,
        });
      }

      // Stop periodic flushing and do a final flush with the complete result
      flusher.stop();

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
        messages: flusher.getBufferedMessages(),
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

      // --- Post-run extraction (plan, technical design, context entry) ---
      const postRunLog = (message: string) => {
        this.taskEventLog.log({ taskId, category: 'agent_debug', severity: 'debug', message }).catch(() => {});
      };
      await this.postRunExtractor.extractPlan(taskId, result, agentType, postRunLog, context.revisionReason);
      await this.postRunExtractor.extractTechnicalDesign(taskId, result, agentType, postRunLog, context.revisionReason);
      await this.postRunExtractor.saveContextEntry(taskId, run.id, agentType, context.revisionReason, result, postRunLog);
      await this.postRunExtractor.createSuggestedTasks(taskId, agentType, result, postRunLog);

      // Release spawn guard before outcome transition — the agent setup is long
      // complete at this point, and the transition may fire a follow-up agent
      // (e.g. reviewer after implementor) via a fire_and_forget start_agent hook.
      // If we hold the guard, the follow-up agent's execute() will see
      // spawningTasks.has(taskId) === true and throw "duplicate launch prevented".
      this.spawningTasks.delete(taskId);

      // Handle outcome — resolve outcome and execute transitions
      await this.outcomeResolver.resolveAndTransition({
        taskId, result, run, worktree, worktreeManager, phase, context,
      });

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
        await this.notificationRouter.send({
          taskId,
          title: `Agent ${finalStatus}`,
          body: `${agentType} agent ${finalStatus} for task: ${task.title}`,
          channel: run.id,
          actions: [{ label: 'View', callbackData: `v|${taskId}` }],
        });
      } catch (notifErr) {
        const notifMsg = notifErr instanceof Error ? notifErr.message : String(notifErr);
        this.taskEventLog.log({
          taskId,
          category: 'system',
          severity: 'warning',
          message: `Notification send failed: ${notifMsg}`,
          data: { agentRunId: run.id, error: notifMsg },
        }).catch(() => {});
      }

      // Check message queue for follow-up messages
      const pendingQueue = this.messageQueues.get(taskId);
      if (pendingQueue && pendingQueue.length > 0) {
        try {
          // Defensive no-op: spawn lock already released before resolveAndTransition (line 565)
          this.spawningTasks.delete(taskId);
          const callbacks = this.activeCallbacks.get(taskId);
          await this.execute(taskId, context.mode, agentType, context.revisionReason, callbacks?.onOutput, callbacks?.onMessage, callbacks?.onStatusChange);
        } catch (queueErr) {
          const queueMsg = queueErr instanceof Error ? queueErr.message : String(queueErr);
          this.taskEventLog.log({
            taskId,
            category: 'agent',
            severity: 'warning',
            message: `Queue follow-up message processing failed: ${queueMsg}`,
            data: { agentRunId: run.id },
          }).catch(() => {});
        }
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
      // Delete the promise/agent references first to prevent leaks even if cleanup throws
      this.backgroundPromises.delete(run.id);
      this.runningAgents.delete(taskId);
      this.spawningTasks.delete(taskId);
      flusher.stop();
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

  isSpawning(taskId: string): boolean {
    return this.spawningTasks.has(taskId);
  }

  getActiveRunIds(): string[] {
    return [...this.backgroundPromises.keys(), ...this.initializingRunIds];
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

    // Use the tracked running agent instance, falling back to framework
    const agent = this.runningAgents.get(run.taskId) ?? this.agentFramework.getAgent(run.agentType);
    await agent.stop(run.taskId);
    this.runningAgents.delete(run.taskId);

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

}
