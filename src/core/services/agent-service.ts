import type {
  AgentRun,
  AgentMode,
  RevisionReason,
  AgentContext,
  AgentConfig,
  AgentChatMessage,
  PostProcessingLogCategory,
  AgentChatMessagePostProcessingLog,
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
import type { ScheduledAgentService } from './scheduled-agent-service';
import type { AgentLibRegistry } from './agent-lib-registry';
import type { IDevServerManager } from '../interfaces/dev-server-manager';
import { AgentSubscriptionRegistry } from './agent-subscription-registry';
import type { AgentNotificationPayload } from '../../shared/types';
import * as path from 'path';
import * as fs from 'fs';
import { validateOutcomePayload } from '../handlers/outcome-schemas';
import { now } from '../stores/utils';
import { getActivePhase, getActivePhaseIndex, isMultiPhase } from '../../shared/phase-utils';
import { SubtaskSyncInterceptor } from './subtask-sync-interceptor';
import { AgentOutputFlusher } from './agent-output-flusher';
import { PostRunExtractor } from './post-run-extractor';
import { getAppLogger } from './app-logger';
import { formatSystemNotification } from './pipeline-notification-context';

/**
 * Agent types that are read-only (analysis only, never commit code changes).
 * These agents skip branch creation/switching and worktree clean/rebase since
 * they don't need a dedicated branch — they reuse whatever branch the worktree
 * is currently on.
 */
const READONLY_AGENT_TYPES = new Set([
  'post-mortem-reviewer',
  'task-workflow-reviewer',
  'reviewer',
  'investigator',
]);

export class AgentService implements IAgentService {
  private backgroundPromises = new Map<string, Promise<void>>();
  private messageQueues = new Map<string, string[]>();
  private activeCallbacks = new Map<string, { onOutput?: (chunk: string) => void; onMessage?: (msg: AgentChatMessage) => void; onStatusChange?: (status: string) => void }>();
  private runningAgents = new Map<string, IAgent>();
  private spawningTasks = new Set<string>();
  /** Interrupted runs awaiting session resume on next execute() for the same task. */
  private pendingResumes = new Map<string, import('../../shared/types').AgentRun>();
  private readonly postRunExtractor: PostRunExtractor;

  private enqueueInjectedMessage?: (
    sessionId: string,
    content: string,
    metadata: Record<string, unknown>,
  ) => void;

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
    private scheduledAgentService?: ScheduledAgentService,
    private agentLibRegistry?: AgentLibRegistry,
    private devServerManager?: IDevServerManager,
    private subscriptionRegistry?: AgentSubscriptionRegistry,
    private onAgentSubscriptionFired?: (
      sessionId: string,
      payload: AgentNotificationPayload,
    ) => void,
    private onTaskUpdated?: (taskId: string, task: import('../../shared/types').Task) => void,
  ) {
    this.postRunExtractor = new PostRunExtractor(this.taskStore, this.taskContextStore, this.taskEventLog, this.notificationRouter);
  }

  setInjectedMessageHandler(
    handler: (sessionId: string, content: string, metadata: Record<string, unknown>) => void,
  ): void {
    this.enqueueInjectedMessage = handler;
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

        // Unlock worktree (only if it still exists on disk)
        try {
          const task = await this.taskStore.getTask(run.taskId);
          if (task) {
            const project = await this.projectStore.getProject(task.projectId);
            if (project?.path) {
              const wm = this.createWorktreeManager(project.path);
              const wt = await wm.get(run.taskId);
              if (wt) {
                await wm.unlock(run.taskId);
              } else {
                getAppLogger().debug('AgentService', `recoverOrphanedRuns: worktree already removed for task ${run.taskId}, skipping unlock`);
              }
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
          message: 'Agent run interrupted by app shutdown — will attempt session resume',
          data: { agentRunId: run.id, agentType: run.agentType, mode: run.mode },
        });

        recovered.push({ ...run, status: 'failed', outcome: 'interrupted', completedAt });
      } catch (err) {
        getAppLogger().logError('AgentService', `Failed to recover orphaned run ${run.id}`, err);
      }
    }

    return recovered;
  }

  queueMessage(taskId: string, message: string): void {
    const queue = this.messageQueues.get(taskId) || [];
    queue.push(message);
    this.messageQueues.set(taskId, queue);
  }

  setPendingResume(taskId: string, interruptedRun: import('../../shared/types').AgentRun): void {
    this.pendingResumes.set(taskId, interruptedRun);
  }

  clearPendingResume(taskId: string): void {
    this.pendingResumes.delete(taskId);
  }

  async execute(taskId: string, mode: AgentMode, agentType: string, revisionReason?: RevisionReason, onOutput?: (chunk: string) => void, onMessage?: (msg: AgentChatMessage) => void, onStatusChange?: (status: string) => void, additionalContext?: Record<string, unknown>): Promise<AgentRun> {
    // Pre-spawn guard: prevent duplicate agent launches for the same task
    if (this.spawningTasks.has(taskId)) {
      throw new Error(`Agent already spawning for task ${taskId} — duplicate launch prevented`);
    }
    this.spawningTasks.add(taskId);

    // Extract pending resume info early (before worktree operations need it).
    // Discard stale entries older than 10 minutes to avoid resuming an expired session.
    const RESUME_TTL_MS = 10 * 60 * 1000;
    let pendingResumeRun = this.pendingResumes.get(taskId);
    if (pendingResumeRun) {
      this.pendingResumes.delete(taskId);
      const age = now() - (pendingResumeRun.completedAt ?? pendingResumeRun.startedAt);
      if (age > RESUME_TTL_MS) {
        getAppLogger().warn(`Agent:${agentType}`, `Discarding stale pending resume for task ${taskId} (age: ${Math.round(age / 1000)}s)`, { taskId, resumeRunId: pendingResumeRun.id });
        pendingResumeRun = undefined;
      }
    }

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
    // For multi-phase tasks, determine the task integration branch.
    // Phase worktrees branch from the task branch (not main) so later phases
    // see code from earlier merged phases.
    const multiPhase = isMultiPhase(task);
    let taskBranch: string | undefined = (task.metadata?.taskBranch as string) || undefined;

    if (multiPhase && !taskBranch) {
      // First phase start — create the task integration branch from origin/main
      taskBranch = `task/${taskId}/integration`;
      const gitOpsRoot = this.createGitOps(projectPath);
      await gitOpsRoot.fetch('origin');
      try {
        await gitOpsRoot.createBranchRef(taskBranch, 'origin/main');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already exists/.test(msg)) {
          throw new Error(`Failed to create task integration branch "${taskBranch}": ${msg}`, { cause: err });
        }
      }
      await gitOpsRoot.push(taskBranch);
      await this.taskStore.updateTask(taskId, {
        metadata: { ...task.metadata, taskBranch },
      });
      await this.taskEventLog.log({
        taskId,
        category: 'git',
        severity: 'info',
        message: `Task integration branch created: ${taskBranch}`,
        data: { taskBranch },
      });
    }

    // Determine base branch and phase branch name
    const isReadOnlyAgent = READONLY_AGENT_TYPES.has(agentType);
    const baseBranch = multiPhase && taskBranch ? `origin/${taskBranch}` : undefined;
    let branch = `task/${taskId}`;
    if (multiPhase) {
      const phaseIdx = getActivePhaseIndex(task.phases);
      if (phaseIdx >= 0) {
        branch = `task/${taskId}/phase-${phaseIdx + 1}`;
      }
    }

    let worktree = await worktreeManager.get(taskId);
    if (!worktree) {
      worktree = await worktreeManager.create(branch, taskId, baseBranch);
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'info',
        message: `Worktree created on branch ${branch}`,
        data: { branch, baseBranch: baseBranch ?? 'origin/main', path: worktree.path, taskId },
      });
    } else if (isReadOnlyAgent) {
      // Read-only agents (post-mortem-reviewer, task-workflow-reviewer, investigator, reviewer)
      // don't commit code changes — skip branch creation/switching entirely.
      // Reuse whatever branch the worktree is currently on.
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'info',
        message: `Worktree reused at ${worktree.path} (read-only agent "${agentType}", skipping branch switch)`,
        data: { path: worktree.path, currentBranch: worktree.branch, agentType },
      });
    } else {
      // Worktree exists from a prior agent phase (e.g. planner).
      // Checkout the expected branch so diff verification and artifact
      // recording use the correct branch — not the stale one left behind.
      if (worktree.branch !== branch) {
        const gitOps = this.createGitOps(worktree.path);
        try {
          await gitOps.createBranch(branch, baseBranch ?? 'origin/main');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/already exists|exists;.*cannot create/.test(msg)) {
            // Branch already exists from a prior attempt or git ref hierarchy conflict — just checkout
            await gitOps.checkout(branch);
          } else {
            throw new Error(`Failed to switch worktree to branch "${branch}": ${msg}`, { cause: err });
          }
        }
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'info',
          message: `Worktree reused at ${worktree.path}, checked out branch ${branch} (was ${worktree.branch})`,
          data: { path: worktree.path, previousBranch: worktree.branch, newBranch: branch },
        });
        worktree = { ...worktree, branch };
      } else {
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'info',
          message: `Worktree reused at ${worktree.path}`,
          data: { path: worktree.path },
        });
      }
    }

    // Pre-check: verify worktree path actually exists on disk before proceeding
    if (!fs.existsSync(worktree.path)) {
      const msg = `Worktree path does not exist on disk: ${worktree.path}. Recreating worktree.`;
      getAppLogger().warn(`Agent:${agentType}`, msg, { taskId, path: worktree.path });
      await this.taskEventLog.log({ taskId, category: 'worktree', severity: 'warning', message: msg });
      // Remove stale worktree record and recreate
      await worktreeManager.delete(taskId);
      worktree = await worktreeManager.create(branch, taskId, baseBranch);
      getAppLogger().info(`Agent:${agentType}`, `Worktree recreated at ${worktree.path}`, { taskId });
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
    // Skip clean + rebase when resuming an interrupted run — preserve the agent's in-progress work.
    // Also skip for read-only agents — they don't modify the worktree and don't need a fresh baseline.
    if (isReadOnlyAgent) {
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'info',
        message: `Skipping worktree clean/rebase — read-only agent "${agentType}" does not modify the worktree`,
        data: { taskId, agentType },
      });
    } else if (pendingResumeRun) {
      // Abort any in-progress rebase left over from the crash
      try {
        const gitOps = this.createGitOps(worktree.path);
        await gitOps.rebaseAbort();
        await this.taskEventLog.log({ taskId, category: 'worktree', severity: 'info', message: 'Aborted stale rebase from interrupted run' });
      } catch { /* not in rebase state — expected */ }
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'info',
        message: 'Skipping worktree clean/rebase — resuming interrupted agent run',
        data: { taskId, resumedFromRunId: pendingResumeRun.id },
      });
    } else {
    try {
      const gitOps = this.createGitOps(worktree.path);

      // Discard any uncommitted changes or untracked files left from prior runs.
      // Skip for uncommitted_changes — the agent needs those changes to commit them.
      if (revisionReason === 'uncommitted_changes') {
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'info',
          message: 'Skipping worktree clean for uncommitted_changes revision — agent needs to commit existing changes',
          data: { taskId },
        });
      } else {
        await gitOps.clean();
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'debug',
          message: 'Worktree cleaned (reset uncommitted changes)',
          data: { taskId },
        });
      }

      // Fetch and best-effort rebase so the agent starts from the latest base.
      // For multi-phase tasks, rebase onto the task integration branch (not main)
      // so the phase branch only contains phase-specific changes.
      // Skip for resolve_conflicts — the agent handles the entire rebase itself.
      const rebaseTarget = baseBranch ?? 'origin/main';
      await gitOps.fetch('origin');
      if (revisionReason === 'merge_failed') {
        await this.taskEventLog.log({
          taskId,
          category: 'worktree',
          severity: 'info',
          message: 'Skipping pre-agent rebase for merge_failed (agent will rebase)',
          data: { taskId },
        });
      } else {
        try {
          await gitOps.rebase(rebaseTarget);
          await this.taskEventLog.log({
            taskId,
            category: 'worktree',
            severity: 'info',
            message: `Worktree rebased onto ${rebaseTarget}`,
            data: { taskId, rebaseTarget },
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
    } // end: skip clean/rebase for interrupted resume

    // Ensure node_modules symlink is intact (git clean or a prior agent run may
    // have replaced it with a real directory or removed it entirely).
    try {
      await worktreeManager.ensureNodeModules(taskId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.taskEventLog.log({
        taskId,
        category: 'worktree',
        severity: 'error',
        message: `ensureNodeModules failed — agent may encounter missing module errors: ${errorMsg}`,
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
    getAppLogger().info(`Agent:${agentType}`, `Agent started for task "${task.title}"`, {
      taskId, agentRunId: run.id, mode,
      worktreePath: worktree.path, branch: worktree.branch,
    });

    // 6. Build context — agent runs in the worktree, not the main checkout
    // Consume any queued message as customPrompt
    const queue = this.messageQueues.get(taskId);
    const customPrompt = queue && queue.length > 0 ? queue.shift() : undefined;
    if (queue && queue.length === 0) this.messageQueues.delete(taskId);

    const devServer = this.devServerManager?.getStatus(task.id);
    const context: AgentContext = {
      task,
      project,
      workdir: worktree.path,
      mode,
      revisionReason,
      customPrompt,
      devServerUrl: devServer?.status === 'ready' ? devServer.url : undefined,
      additionalContext,
    };

    // Session ID management:
    // Sessions are identified by the run ID of the original creator (mode='new').
    // All subsequent runs in the chain (revisions, reviewer) resume the same session.
    //
    // Implementor↔Reviewer shared session chain:
    //   implementor (new) → creates session
    //   reviewer (new)    → resumes implementor's session
    //   implementor (rev) → resumes same session
    //   reviewer (new)    → resumes same session
    //   ...continues for multiple review cycles
    //
    // Other agents (planner, designer) maintain their own session chains.

    // Crash recovery: if this task has a pending resume from an interrupted run,
    // resume that session instead of creating a new one.
    if (pendingResumeRun) {
      context.resumedFromRunId = pendingResumeRun.id;

      // For mode='new' (non-reviewer): the interrupted run created (or resumed) a session.
      // Use the stored sessionId to handle double-crash scenarios where the interrupted
      // run itself was a crash-recovery resume of an even earlier session.
      // For other modes (revision, reviewer), fall through to existing logic below
      // which re-derives the correct original session ID.
      if (pendingResumeRun.mode === 'new' && pendingResumeRun.agentType !== 'reviewer') {
        context.sessionId = pendingResumeRun.sessionId ?? pendingResumeRun.id;
        context.resumeSession = true;
        getAppLogger().info(`Agent:${agentType}`, `Resuming interrupted session ${context.sessionId}`, { taskId, resumeRunId: pendingResumeRun.id, sessionId: context.sessionId });
        await this.taskEventLog.log({
          taskId, category: 'agent', severity: 'info',
          message: `Crash recovery: resuming interrupted session ${context.sessionId}`,
          data: { agentRunId: run.id, resumeRunId: pendingResumeRun.id, sessionId: context.sessionId, mode: pendingResumeRun.mode },
        });
      }
    }

    if (!context.sessionId) {
      if (agentType === 'reviewer' && mode === 'new') {
        // Reviewer resumes the implementor's session for shared context.
        // Use the stored sessionId from the run record (not run.id), because after
        // crash recovery the run that completed may have resumed an earlier session.
        const runs = await this.agentRunStore.getRunsForTask(taskId);
        const origImplRun = this.findOriginalSessionRun(runs, 'implementor');
        const implSessionId = origImplRun?.sessionId ?? origImplRun?.id;
        if (implSessionId) {
          context.sessionId = implSessionId;
          context.resumeSession = true;
          getAppLogger().debug(`Agent:reviewer`, `Reviewer will resume implementor session ${implSessionId}`, { taskId, implRunId: origImplRun!.id, implSessionId });
        } else {
          context.sessionId = run.id;
          context.resumeSession = false;
          getAppLogger().debug(`Agent:reviewer`, `No implementor session found — reviewer will create own session`, { taskId });
        }
      } else if (mode === 'revision') {
        const runs = await this.agentRunStore.getRunsForTask(taskId);
        // Find the original session creator (first mode='new' completed run).
        // Use the stored sessionId (not run.id) to handle crash-recovery scenarios
        // where the completing run resumed an earlier session.
        const origRun = this.findOriginalSessionRun(runs, agentType);
        const sessionId = origRun?.sessionId ?? origRun?.id;
        context.sessionId = sessionId;
        context.resumeSession = !!context.sessionId;
        if (origRun) {
          getAppLogger().debug(`Agent:${agentType}`, `Revision will resume session ${sessionId}`, { taskId, origRunId: origRun.id, sessionId });
        } else {
          const msg = `No prior completed ${agentType} run found — revision will use full prompt instead of session resume`;
          getAppLogger().warn(`Agent:${agentType}`, msg, { taskId });
          await this.taskEventLog.log({ taskId, category: 'agent', severity: 'warning', message: msg, data: { agentType, mode } });
        }
      } else {
        context.sessionId = run.id;
        context.resumeSession = false;
      }
    }

    // Log the resolved session configuration
    await this.taskEventLog.log({
      taskId, category: 'agent', severity: 'debug',
      message: `Session resolved: id=${context.sessionId}, resume=${context.resumeSession}`,
      data: { agentRunId: run.id, sessionId: context.sessionId, resumeSession: context.resumeSession, resumedFromRunId: context.resumedFromRunId },
    });

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

    // Store the resolved engine, effective model, and session ID on the run record
    const resolvedEngine = agentDefEngine ?? 'claude-code';
    let effectiveModel = config.model;
    if (!effectiveModel && this.agentLibRegistry) {
      try { effectiveModel = this.agentLibRegistry.getLib(resolvedEngine).getDefaultModel(); } catch { /* ignore */ }
    }
    await this.agentRunStore.updateRun(run.id, {
      engine: agentDefEngine,
      ...(effectiveModel ? { model: effectiveModel } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    });

    // Log resolved agent configuration
    await this.taskEventLog.log({
      taskId, category: 'agent', severity: 'debug',
      message: `Agent config resolved: engine=${resolvedEngine}, model=${effectiveModel ?? 'default'}`,
      data: { agentRunId: run.id, engine: resolvedEngine, model: effectiveModel, sessionId: context.sessionId, resumeSession: context.resumeSession, workdir: context.workdir },
    });

    // 7. Store active callbacks for this task
    this.activeCallbacks.set(taskId, { onOutput, onMessage, onStatusChange });

    // 8. Resolve agent from framework — Agent resolves its lib internally via config.engine
    const agent = this.agentFramework.getAgent(agentType);
    this.runningAgents.set(taskId, agent);

    const promise = this.runAgentInBackground(agent, context, config, run, task, phase, worktree, worktreeManager, agentType, onOutput, onMessage, onStatusChange);
    this.backgroundPromises.set(run.id, promise);

    // 9. Return run immediately (status: 'running')
    return run;
    } catch (err) {
      // Setup failed before the agent could start — mark the DB run as failed
      // so it doesn't remain as 'running' forever.
      const setupError = err instanceof Error ? err.message : String(err);
      const setupStack = err instanceof Error ? err.stack : undefined;
      if (run) {
        await this.agentRunStore.updateRun(run.id, {
          status: 'failed',
          outcome: 'interrupted',
          completedAt: now(),
          error: `Setup failed: ${setupError}`,
        });
        await this.taskEventLog.log({
          taskId, category: 'agent', severity: 'error',
          message: `Agent setup failed before execution: ${setupError}`,
          data: { agentRunId: run.id, error: setupError, ...(setupStack ? { stack: setupStack } : {}) },
        });
      }
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
      // Write to task-level event log (per-task timeline)
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message,
        data,
      }).catch(() => {}); // fire-and-forget

      // Also write to the app-level debug log so agent logs appear in the main Debug Logs page
      const logLevel = data?.error || data?.stack ? 'error' : 'debug';
      getAppLogger()[logLevel](`Agent:${agentType}`, message, { taskId, agentRunId: run.id, ...data });
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
    const hasSubtaskTracking = agentType === 'implementor';

    const subtaskInterceptor = hasSubtaskTracking
      ? new SubtaskSyncInterceptor(
          this.taskStore,
          taskId,
          task.phases,
          activePhaseIdxForSync,
          isMultiPhase(task),
          effectiveSubtasks ?? [],
          (msg) => onLog(msg),
          this.onTaskUpdated,
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
        const errorStack = err instanceof Error ? err.stack : undefined;
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
        // Extract kill metadata from error message if present (e.g. "[kill_reason=timeout]")
        const killReasonMatch = errorMsg.match(/\[kill_reason=(\w+)\]/);
        const killReason = killReasonMatch?.[1];
        const exitCodeMatch = errorMsg.match(/exited with code (\d+)/);
        const rawExitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : undefined;

        // Log to app debug log with full diagnostic context
        getAppLogger().error(`Agent:${agentType}`, `Agent failed for task "${task.title}"`, {
          taskId,
          agentRunId: run.id,
          error: errorMsg,
          ...(errorStack ? { stack: errorStack } : {}),
          ...(killReason ? { killReason } : {}),
          ...(rawExitCode != null ? { rawExitCode } : {}),
          cwd: context.workdir ?? context.project.path,
          model: config.model,
          mode: run.mode,
          engine: config.engine,
          partialInputTokens,
          partialOutputTokens,
          partialMessageCount,
        });

        await this.taskEventLog.log({
          taskId,
          category: 'agent',
          severity: 'error',
          message: `Agent ${agentType} failed: ${errorMsg}`,
          data: {
            agentRunId: run.id,
            error: errorMsg,
            ...(errorStack ? { stack: errorStack } : {}),
            ...(killReason ? { killReason } : {}),
            ...(rawExitCode != null ? { rawExitCode } : {}),
            engine: config.engine,
            model: config.model,
            mode: run.mode,
            sessionId: context.sessionId,
            resumeSession: context.resumeSession,
            cwd: context.workdir,
          },
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

        // Emit status change so the UI shows the failure toast
        onStatusChange?.('failed');
        onMessage?.({ type: 'status', status: 'failed', message: `Agent failed: ${errorMsg}`, timestamp: Date.now() });

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

      // --- Post-processing logging infrastructure ---
      const postProcessingStart = performance.now();
      const categoryTimings: Record<string, number> = {};
      const addTiming = (category: string, durationMs: number) => {
        categoryTimings[category] = (categoryTimings[category] ?? 0) + durationMs;
      };
      const emitPostLog = (
        category: PostProcessingLogCategory,
        message: string,
        details?: Record<string, unknown>,
        durationMs?: number,
      ) => {
        const msg: AgentChatMessagePostProcessingLog = {
          type: 'post_processing_log',
          category,
          message,
          ...(details ? { details } : {}),
          ...(durationMs != null ? { durationMs } : {}),
          timestamp: Date.now(),
        };
        flusher.appendMessage(msg);
        onMessage?.(msg);
        if (durationMs != null) addTiming(category, durationMs);
      };

      // Post-agent validation loop
      const validationCommands = ValidationRunner.getValidationCommands(agentType, context.project.config);
      const maxValidationRetries = (context.project.config?.maxValidationRetries as number | undefined) ?? 3;

      if (validationCommands.length > 0) {
        emitPostLog('validation', `Running validation: ${validationCommands.length} command(s) configured`, { commands: validationCommands, maxRetries: maxValidationRetries });
        const valStart = performance.now();
        result = await this.validationRunner.runWithRetries({
          agent, context, config, run, taskId,
          validationCommands, maxRetries: maxValidationRetries,
          initialResult: result,
          projectPath: context.project.path ?? undefined,
          wrappedOnOutput, onLog, onPromptBuilt, wrappedOnMessage,
        });
        const valDuration = Math.round(performance.now() - valStart);
        emitPostLog('validation', `Validation complete: exitCode=${result.exitCode}`, { exitCode: result.exitCode }, valDuration);
      } else {
        emitPostLog('validation', 'Validation skipped (no commands configured)');
      }

      // Stop periodic flushing and do a final flush with the complete result
      flusher.stop();

      // Update run
      const completedAt = now();
      const runStatus = result.exitCode === 0
        ? 'completed'
        : result.killReason === 'stopped' ? 'cancelled' : 'failed';
      const finalMessageCount = 'lastMessageCount' in agent ? (agent as { lastMessageCount?: number }).lastMessageCount : undefined;
      emitPostLog('system', 'Saving agent run results to database', {
        status: runStatus, outcome: result.outcome, exitCode: result.exitCode,
        costInputTokens: result.costInputTokens, costOutputTokens: result.costOutputTokens,
      });
      const dbUpdateStart = performance.now();
      await this.agentRunStore.updateRun(run.id, {
        status: runStatus,
        output: result.output,
        outcome: result.outcome,
        payload: result.payload ?? result.structuredOutput,
        exitCode: result.exitCode,
        completedAt,
        costInputTokens: result.costInputTokens,
        costOutputTokens: result.costOutputTokens,
        cacheReadInputTokens: result.cacheReadInputTokens,
        cacheCreationInputTokens: result.cacheCreationInputTokens,
        totalCostUsd: result.totalCostUsd,
        prompt: result.prompt,
        error: result.error,
        messageCount: finalMessageCount,
        messages: flusher.getBufferedMessages(),
        model: result.model,
      });
      const dbUpdateDuration = Math.round(performance.now() - dbUpdateStart);
      emitPostLog('system', `Agent run saved: status=${runStatus}, outcome=${result.outcome}`, { status: runStatus, outcome: result.outcome, exitCode: result.exitCode }, dbUpdateDuration);
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
          emitPostLog('system', `Outcome payload validation failed: ${validation.error}`, { outcome: result.outcome, error: validation.error });
          await this.taskEventLog.log({
            taskId,
            category: 'agent',
            severity: 'warning',
            message: `Invalid outcome payload: ${validation.error}`,
            data: { outcome: result.outcome, error: validation.error },
          });
          // Don't block — still attempt transition (warn-and-proceed for v1)
        } else {
          emitPostLog('system', `Outcome payload validated: outcome=${result.outcome}`, { outcome: result.outcome });
        }
      }

      // --- Post-run extraction (plan, technical design, context entry) ---
      const postRunLog = (message: string) => {
        this.taskEventLog.log({ taskId, category: 'agent_debug', severity: 'debug', message }).catch(() => {});
      };
      const extractionPostLog = (message: string, details?: Record<string, unknown>, durationMs?: number) => {
        emitPostLog('extraction', message, details, durationMs);
      };
      await this.postRunExtractor.extractPlan(taskId, result, agentType, postRunLog, context.revisionReason, run.id, extractionPostLog);
      await this.postRunExtractor.extractTechnicalDesign(taskId, result, agentType, postRunLog, context.revisionReason, run.id, extractionPostLog);
      await this.postRunExtractor.extractTaskEstimates(taskId, result, agentType, postRunLog, extractionPostLog);
      await this.postRunExtractor.saveContextEntry(taskId, run.id, agentType, context.revisionReason, result, postRunLog, extractionPostLog);
      await this.postRunExtractor.createSuggestedTasks(taskId, agentType, result, postRunLog, extractionPostLog);
      await this.postRunExtractor.linkBugToSourceTasks(taskId, result, agentType, postRunLog, extractionPostLog);

      // Compute and persist run diagnostics
      const diagnostics = this.postRunExtractor.computeRunDiagnostics(flusher.getBufferedMessages(), result);
      if (diagnostics) {
        await this.agentRunStore.updateRun(run.id, { diagnostics });
      }

      // Extract summary for outcome transition context (previously done by appendSummaryComment)
      const so = result.structuredOutput as { summary?: string; planSummary?: string; investigationSummary?: string; designSummary?: string } | undefined;
      const agentSummary = so?.investigationSummary ?? so?.designSummary ?? so?.planSummary ?? so?.summary;

      // Release spawn lock before transition so that start_agent hooks
      // (which call agentService.execute()) can re-acquire it for follow-up agents.
      // The agent run is fully recorded at this point — the lock only needs to
      // protect the setup/execution phase. The finally block's delete is kept as a safety net.
      this.spawningTasks.delete(taskId);
      this.taskEventLog.log({
        taskId,
        category: 'agent_debug',
        severity: 'debug',
        message: `Spawn lock released before outcome transition (runId=${run.id})`,
      }).catch(() => {});

      // Handle outcome — resolve outcome and execute transitions
      emitPostLog('system', `Starting outcome resolution: outcome=${result.outcome ?? 'none'}`, { outcome: result.outcome });
      const outcomeStart = performance.now();
      await this.outcomeResolver.resolveAndTransition({
        taskId, result, run, worktree, worktreeManager, phase, context, summary: agentSummary,
        onPostLog: emitPostLog,
      });
      const outcomeDuration = Math.round(performance.now() - outcomeStart);
      emitPostLog('system', 'Outcome resolution complete', { outcome: result.outcome }, outcomeDuration);

      // --- Notify subscribed chat sessions ---
      if (this.subscriptionRegistry) {
        const subscribers = this.subscriptionRegistry.get(taskId);
        emitPostLog('notification', `Subscription check: ${subscribers.length} subscriber(s) found`, { subscriberCount: subscribers.length });
        if (subscribers.length > 0) {
          const updatedTask = await this.taskStore.getTask(taskId);
          for (const sub of subscribers) {
            const payload: AgentNotificationPayload = {
              taskId,
              taskTitle: updatedTask?.title ?? task.title,
              fromStatus: task.status,
              toStatus: updatedTask?.status ?? task.status,
              outcome: result.outcome ?? 'unknown',
              agentType,
              agentRunId: run.id,
              summary: agentSummary,
              autoNotify: sub.autoNotify,
            };

            // Tier 1: WebSocket push (always)
            try {
              this.onAgentSubscriptionFired?.(sub.sessionId, payload);
            } catch (err) {
              getAppLogger().warn('AgentService', 'Failed to fire subscription WS notification', {
                sessionId: sub.sessionId, taskId,
                error: err instanceof Error ? err.message : String(err),
              });
            }

            // Tier 2: Injected agent turn (if requested)
            if (sub.autoNotify && this.enqueueInjectedMessage) {
              const content = formatSystemNotification({
                agentType,
                taskTitle: updatedTask?.title ?? task.title,
                outcome: result.outcome ?? 'unknown',
                fromStatus: task.status,
                toStatus: updatedTask?.status ?? task.status,
                summary: agentSummary,
                prLink: updatedTask?.prLink ?? undefined,
              });
              try {
                this.enqueueInjectedMessage(sub.sessionId, content, {
                  injected: true,
                  taskId,
                  taskTitle: updatedTask?.title ?? task.title,
                  outcome: result.outcome ?? 'unknown',
                  agentType,
                  agentRunId: run.id,
                  autoNotify: sub.autoNotify,
                });
              } catch (err) {
                getAppLogger().warn('AgentService', 'Failed to enqueue injected message', {
                  sessionId: sub.sessionId, taskId,
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          }

          // Clean up subscriptions when task reaches a terminal state
          if (updatedTask && AgentSubscriptionRegistry.isTerminalStatus(updatedTask.status)) {
            this.subscriptionRegistry.removeTask(taskId);
            emitPostLog('notification', `Subscriptions cleaned up: task reached terminal state "${updatedTask.status}"`);
          }
        }
      }

      // Log completion event
      const completionLevel = result.exitCode === 0 ? 'info' : 'error';
      const completionMsg = `Agent ${agentType} completed with outcome: ${result.outcome ?? 'none'}${result.killReason ? ` [kill_reason=${result.killReason}]` : ''}`;
      const completionData = {
        agentRunId: run.id,
        exitCode: result.exitCode,
        outcome: result.outcome,
        ...(result.error ? { error: result.error } : {}),
        ...(result.killReason ? { killReason: result.killReason } : {}),
        ...(result.rawExitCode != null ? { rawExitCode: result.rawExitCode } : {}),
        costInputTokens: result.costInputTokens,
        costOutputTokens: result.costOutputTokens,
      };
      await this.taskEventLog.log({
        taskId,
        category: 'agent',
        severity: completionLevel,
        message: completionMsg,
        data: completionData,
      });
      getAppLogger()[completionLevel](`Agent:${agentType}`, `${completionMsg} for task "${task.title}"`, { taskId, ...completionData });

      // Emit status change
      const finalStatus = result.exitCode === 0
        ? 'completed'
        : result.killReason === 'stopped' ? 'cancelled' : 'failed';
      onStatusChange?.(finalStatus);
      const statusMessage = result.error ? `Agent ${finalStatus}: ${result.error}` : `Agent ${finalStatus}`;
      onMessage?.({ type: 'status', status: finalStatus, message: statusMessage, timestamp: Date.now() });

      // Send native notification
      try {
        let notifBody = `${agentType} agent ${finalStatus} for task: ${task.title}`;
        const notifActions = [{ label: 'View', callbackData: `v|${taskId}` }];

        if (finalStatus === 'failed') {
          if (result.error) {
            const truncatedError = result.error.length > 500 ? result.error.slice(0, 500) + '...' : result.error;
            notifBody += `\n\nReason: ${truncatedError}`;
          }
          notifActions.push({ label: 'Restart Agent', callbackData: `ra|${taskId}` });
        }

        emitPostLog('notification', `Sending native notification: channel=${run.id}`, { channel: run.id, status: finalStatus });
        const notifStart = performance.now();
        await this.notificationRouter.send({
          taskId,
          title: `Agent ${finalStatus}`,
          body: notifBody,
          channel: run.id,
          actions: notifActions,
        });
        const notifDuration = Math.round(performance.now() - notifStart);
        emitPostLog('notification', `Native notification sent`, { channel: run.id }, notifDuration);
      } catch (notifErr) {
        const notifMsg = notifErr instanceof Error ? notifErr.message : String(notifErr);
        emitPostLog('notification', `Native notification failed: ${notifMsg}`, { error: notifMsg });
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
      emitPostLog('system', `Message queue check: ${pendingQueue?.length ?? 0} pending message(s)`, { pendingCount: pendingQueue?.length ?? 0 });
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

      // --- Emit timing summary and persist post-processing messages ---
      const postProcessingTotal = Math.round(performance.now() - postProcessingStart);
      emitPostLog('system', `Post-agent processing complete (total: ${postProcessingTotal}ms)`, {
        totalMs: postProcessingTotal,
        timings: categoryTimings,
      }, postProcessingTotal);

      // Persist post-processing log messages that were appended after the initial DB save
      try {
        await this.agentRunStore.updateRun(run.id, {
          messages: flusher.getBufferedMessages(),
        });
      } catch (persistErr) {
        const persistMsg = persistErr instanceof Error ? persistErr.message : String(persistErr);
        getAppLogger().warn('AgentService', `Failed to persist post-processing messages: ${persistMsg}`, { taskId, agentRunId: run.id });
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
    return [...this.backgroundPromises.keys()];
  }

  async waitForCompletion(runId: string): Promise<void> {
    const promise = this.backgroundPromises.get(runId);
    if (promise) {
      await promise;
    }
  }

  async stopAllRunningAgents(): Promise<void> {
    const activeRunIds = this.getActiveRunIds();
    if (activeRunIds.length === 0) return;

    getAppLogger().info('AgentService', `Stopping ${activeRunIds.length} running agent(s)`);
    const results = await Promise.allSettled(
      activeRunIds.map(runId =>
        this.stop(runId).catch(err => {
          getAppLogger().warn('AgentService', `Failed to stop agent run ${runId}`, { error: err instanceof Error ? err.message : String(err) });
        })
      )
    );

    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      getAppLogger().warn('AgentService', `${failed}/${activeRunIds.length} agent stop(s) failed during shutdown`);
    } else {
      getAppLogger().info('AgentService', `All ${activeRunIds.length} agent run(s) stopped`);
    }
  }

  async stop(runId: string): Promise<void> {
    const run = await this.agentRunStore.getRun(runId);
    if (!run) throw new Error(`Agent run not found: ${runId}`);

    // Automated agent runs are managed by ScheduledAgentService — delegate to it
    if (run.automatedAgentId && this.scheduledAgentService) {
      await this.scheduledAgentService.stop(runId);
      return;
    }

    // Use the tracked running agent instance, falling back to framework
    const agent = this.runningAgents.get(run.taskId) ?? this.agentFramework.getAgent(run.agentType);

    // Capture accumulated tokens BEFORE stop() wipes telemetry
    const agentInstance = agent as { accumulatedInputTokens?: number; accumulatedOutputTokens?: number };
    const costInputTokens = agentInstance.accumulatedInputTokens ?? undefined;
    const costOutputTokens = agentInstance.accumulatedOutputTokens ?? undefined;

    await agent.stop(run.taskId);
    this.runningAgents.delete(run.taskId);

    // Clear any queued messages to prevent stale messages from being sent on future runs
    this.messageQueues.delete(run.taskId);
    this.activeCallbacks.delete(run.taskId);

    await this.agentRunStore.updateRun(runId, {
      status: 'cancelled',
      completedAt: now(),
      costInputTokens,
      costOutputTokens,
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

  /**
   * Find the original session-creating run for a given agent type.
   * Returns the first (oldest) completed mode='new' run, which is the session file owner.
   * Runs are ordered newest-first, so we reverse-search.
   */
  private findOriginalSessionRun(runs: AgentRun[], agentType: string): AgentRun | undefined {
    // Reverse to find oldest first (runs are newest-first from store)
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i];
      if (r.agentType === agentType && r.mode === 'new' && r.status === 'completed') {
        return r;
      }
    }
    return undefined;
  }

}
