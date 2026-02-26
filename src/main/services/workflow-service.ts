import type {
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TransitionResult,
  AgentRun,
  AgentMode,
  PendingPrompt,
  DashboardStats,
  AgentChatMessage,
  PipelineDiagnostics,
  HookRetryResult,
  HookFailureRecord,
  Transition,
} from '../../shared/types';
import { getActivePhaseIndex } from '../../shared/phase-utils';
import type { ITaskStore } from '../interfaces/task-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IActivityLog } from '../interfaces/activity-log';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IPendingPromptStore } from '../interfaces/pending-prompt-store';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { IAgentService } from '../interfaces/agent-service';
import type { IScmPlatform } from '../interfaces/scm-platform';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { IGitOps } from '../interfaces/git-ops';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { IWorkflowService } from '../interfaces/workflow-service';

interface QuestionResponse {
  questionId: string;
  selectedOptionId?: string;
  answer?: string;
  customText?: string;
}

export class WorkflowService implements IWorkflowService {
  constructor(
    private taskStore: ITaskStore,
    private projectStore: IProjectStore,
    private pipelineEngine: IPipelineEngine,
    private pipelineStore: IPipelineStore,
    private taskEventLog: ITaskEventLog,
    private activityLog: IActivityLog,
    private agentRunStore: IAgentRunStore,
    private pendingPromptStore: IPendingPromptStore,
    private taskArtifactStore: ITaskArtifactStore,
    private agentService: IAgentService,
    private createScmPlatform: (repoPath: string) => IScmPlatform,
    private createWorktreeManager: (path: string) => IWorktreeManager,
    private createGitOps: (cwd: string) => IGitOps,
    private taskContextStore: ITaskContextStore,
  ) {}

  async createTask(input: TaskCreateInput): Promise<Task> {
    const task = await this.taskStore.createTask(input);
    await this.activityLog.log({
      action: 'create',
      entityType: 'task',
      entityId: task.id,
      summary: `Created task: ${task.title}`,
    });
    return task;
  }

  async updateTask(id: string, input: TaskUpdateInput): Promise<Task | null> {
    // Get the existing task first
    const existingTask = await this.taskStore.getTask(id);
    if (!existingTask) return null;

    // Check if pipeline is being changed
    if (input.pipelineId && input.pipelineId !== existingTask.pipelineId) {
      // Validate that the new pipeline exists
      const newPipeline = await this.pipelineStore.getPipeline(input.pipelineId);
      if (!newPipeline) {
        throw new Error(`Pipeline not found: ${input.pipelineId}`);
      }

      // Check if task has running agents
      const agentRuns = await this.agentRunStore.getRunsForTask(id);
      const hasRunningAgent = agentRuns.some((r) => r.status === 'running');
      if (hasRunningAgent) {
        throw new Error('Cannot change pipeline while agent is running');
      }

      // Map the current status to the new pipeline
      let newStatus = existingTask.status;
      const statusExists = newPipeline.statuses.some((s) => s.name === existingTask.status);
      if (!statusExists) {
        // Fall back to first status of the new pipeline
        newStatus = newPipeline.statuses[0]?.name || 'open';
        await this.taskEventLog.log({
          taskId: id,
          category: 'system',
          severity: 'warning',
          message: `Status "${existingTask.status}" not found in new pipeline, resetting to "${newStatus}"`,
          data: { oldStatus: existingTask.status, newStatus, oldPipeline: existingTask.pipelineId, newPipeline: input.pipelineId },
        });
      }

      // Update the status in the input if it's being changed
      if (newStatus !== existingTask.status) {
        input.status = newStatus;
      }

      // Reset phases when changing pipelines (phases are pipeline-specific)
      if (existingTask.phases) {
        input.phases = null;
        await this.taskEventLog.log({
          taskId: id,
          category: 'system',
          severity: 'info',
          message: 'Clearing phases due to pipeline change',
          data: { oldPipeline: existingTask.pipelineId, newPipeline: input.pipelineId },
        });
      }
    }

    const task = await this.taskStore.updateTask(id, input);
    if (task) {
      // Enhanced activity logging for pipeline changes
      if (input.pipelineId && input.pipelineId !== existingTask.pipelineId) {
        await this.activityLog.log({
          action: 'update',
          entityType: 'task',
          entityId: id,
          summary: `Changed pipeline for task: ${task.title}`,
          data: {
            oldPipeline: existingTask.pipelineId,
            newPipeline: input.pipelineId,
            oldStatus: existingTask.status,
            newStatus: task.status,
          },
        });
        await this.taskEventLog.log({
          taskId: id,
          category: 'field_update',
          severity: 'info',
          message: `Pipeline changed from ${existingTask.pipelineId} to ${input.pipelineId}`,
          data: {
            oldPipeline: existingTask.pipelineId,
            newPipeline: input.pipelineId,
            oldStatus: existingTask.status,
            newStatus: task.status,
          },
        });
      } else {
        await this.activityLog.log({
          action: 'update',
          entityType: 'task',
          entityId: id,
          summary: `Updated task: ${task.title}`,
        });
      }
    }
    return task;
  }

  async deleteTask(id: string): Promise<boolean> {
    // Clean up worktree before deleting the task (need task to resolve project)
    const task = await this.taskStore.getTask(id);
    if (task) {
      await this.cleanupWorktree(task);
    }

    const result = await this.taskStore.deleteTask(id);
    if (result) {
      await this.activityLog.log({
        action: 'delete',
        entityType: 'task',
        entityId: id,
        summary: `Deleted task: ${id}`,
      });
    }
    return result;
  }

  async resetTask(id: string, pipelineId?: string): Promise<Task | null> {
    const task = await this.taskStore.getTask(id);
    if (!task) return null;

    // Check no agent is running before resetting
    const agentRuns = await this.agentRunStore.getRunsForTask(id);
    const hasRunningAgent = agentRuns.some((r) => r.status === 'running');
    if (hasRunningAgent) {
      throw new Error('Cannot reset task while agent is running');
    }

    // Validate the new pipeline if provided
    if (pipelineId && pipelineId !== task.pipelineId) {
      const newPipeline = await this.pipelineStore.getPipeline(pipelineId);
      if (!newPipeline) {
        throw new Error(`Pipeline not found: ${pipelineId}`);
      }
    }

    await this.cleanupWorktree(task);

    const result = await this.taskStore.resetTask(id, pipelineId);
    if (result) {
      const pipelineChanged = pipelineId && pipelineId !== task.pipelineId;
      await this.activityLog.log({
        action: 'reset',
        entityType: 'task',
        entityId: id,
        summary: pipelineChanged
          ? `Reset task with new pipeline: ${result.title}`
          : `Reset task: ${result.title}`,
        ...(pipelineChanged ? { data: { oldPipeline: task.pipelineId, newPipeline: pipelineId } } : {}),
      });
    }
    return result;
  }

  async transitionTask(taskId: string, toStatus: string, actor?: string): Promise<TransitionResult> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };

    const result = await this.pipelineEngine.executeTransition(task, toStatus, {
      trigger: 'manual',
      actor,
    });

    if (result.success) {
      await this.activityLog.log({
        action: 'transition',
        entityType: 'task',
        entityId: taskId,
        summary: `Transitioned task from ${task.status} to ${toStatus}`,
        data: { fromStatus: task.status, toStatus, actor },
      });

      // Clean up worktree when task reaches a final state
      const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
      const targetStatus = pipeline?.statuses.find((s) => s.name === toStatus);
      if (targetStatus?.isFinal) {
        await this.cleanupWorktree(task);
      }
    }

    return result;
  }

  async startAgent(taskId: string, mode: AgentMode, agentType: string = 'claude-code', onOutput?: (chunk: string) => void, onMessage?: (msg: AgentChatMessage) => void, onStatusChange?: (status: string) => void): Promise<AgentRun> {
    await this.activityLog.log({
      action: 'agent_start',
      entityType: 'agent_run',
      entityId: taskId,
      summary: `Starting ${agentType} agent in ${mode} mode`,
      data: { agentType, mode },
    });

    const run = await this.agentService.execute(taskId, mode, agentType, onOutput, onMessage, onStatusChange);
    return run;
  }

  async resumeAgent(
    taskId: string,
    message: string,
    callbacks: {
      onOutput?: (chunk: string) => void;
      onMessage?: (msg: AgentChatMessage) => void;
      onStatusChange?: (status: string) => void;
    },
  ): Promise<AgentRun | null> {
    // Queue the message first — the running agent will pick it up,
    // or a newly started agent will receive it on its first turn.
    this.agentService.queueMessage(taskId, message);

    // If an agent is already running for this task, don't start another
    const activeRuns = await this.agentRunStore.getActiveRuns();
    const running = activeRuns.find((r) => r.taskId === taskId && r.status === 'running');
    if (running) return null;

    // Derive mode and agentType from the last run
    const runs = await this.agentRunStore.getRunsForTask(taskId);
    const lastRun = runs[0];
    const mode: AgentMode = lastRun?.mode || 'implement';
    const agentType = lastRun?.agentType || 'claude-code';

    return this.startAgent(taskId, mode, agentType, callbacks.onOutput, callbacks.onMessage, callbacks.onStatusChange);
  }

  async stopAgent(runId: string): Promise<void> {
    await this.agentService.stop(runId);
    await this.activityLog.log({
      action: 'agent_complete',
      entityType: 'agent_run',
      entityId: runId,
      summary: 'Agent stopped',
    });
  }

  async respondToPrompt(promptId: string, response: Record<string, unknown>): Promise<PendingPrompt | null> {
    const prompt = await this.pendingPromptStore.answerPrompt(promptId, response);
    if (!prompt) return null;

    await this.activityLog.log({
      action: 'prompt_response',
      entityType: 'task',
      entityId: prompt.taskId,
      summary: 'Responded to agent prompt',
      data: { promptId, promptType: prompt.promptType },
    });

    await this.taskEventLog.log({
      taskId: prompt.taskId,
      category: 'agent',
      severity: 'info',
      message: `Prompt answered: ${prompt.promptType}`,
      data: { promptId, response },
    });

    // Store Q&A as task context entry so the resumed agent sees it
    const questions = (prompt.payload as Record<string, unknown>)?.questions;
    const summary = this.formatQASummary(questions, response);
    await this.taskContextStore.addEntry({
      taskId: prompt.taskId,
      source: 'user',
      entryType: 'user_input',
      summary,
      data: { questions, answers: response, promptId },
    });

    // Try to resume via the outcome stored on the prompt
    if (prompt.resumeOutcome) {
      const task = await this.taskStore.getTask(prompt.taskId);
      if (task) {
        const transitions = await this.pipelineEngine.getValidTransitions(task, 'agent');
        const resumeToStatus = (prompt.payload as Record<string, unknown> | undefined)?.resumeToStatus as string | undefined;
        const match = (resumeToStatus
          ? transitions.find((t) => t.agentOutcome === prompt.resumeOutcome && t.to === resumeToStatus)
          : undefined)
          ?? transitions.find((t) => t.agentOutcome === prompt.resumeOutcome);
        if (match) {
          await this.pipelineEngine.executeTransition(task, match.to, {
            trigger: 'agent',
            data: { outcome: prompt.resumeOutcome },
          });
        } else {
          await this.taskEventLog.log({
            taskId: prompt.taskId,
            category: 'system',
            severity: 'warning',
            message: `No transition found for resumeOutcome "${prompt.resumeOutcome}" from status "${task.status}"`,
            data: { promptId, resumeOutcome: prompt.resumeOutcome, currentStatus: task.status },
          });
        }
      }
    }

    return prompt;
  }

  async getDashboardStats(now?: number): Promise<DashboardStats> {
    const currentTime = now ?? Date.now();

    const [projects, totalTasks, statusCounts, activeRuns, recentActivity] = await Promise.all([
      this.projectStore.listProjects(),
      this.taskStore.getTotalCount(),
      this.taskStore.getStatusCounts(),
      this.agentRunStore.getActiveRuns(),
      this.activityLog.getEntries({ since: currentTime - 86400000 }),
    ]);

    const tasksByStatus: Record<string, number> = {};
    for (const { status, count } of statusCounts) {
      tasksByStatus[status] = count;
    }

    return {
      projectCount: projects.length,
      totalTasks,
      tasksByStatus,
      activeAgentRuns: activeRuns.length,
      recentActivityCount: recentActivity.length,
    };
  }

  async forceTransitionTask(taskId: string, toStatus: string, actor?: string): Promise<TransitionResult> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };

    const result = await this.pipelineEngine.executeForceTransition(task, toStatus, {
      trigger: 'manual',
      actor,
    });

    if (result.success) {
      await this.activityLog.log({
        action: 'transition',
        entityType: 'task',
        entityId: taskId,
        summary: `Force-transitioned task from ${task.status} to ${toStatus}`,
        data: { fromStatus: task.status, toStatus, actor, forced: true },
      });
    }

    return result;
  }

  async getPipelineDiagnostics(taskId: string): Promise<PipelineDiagnostics | null> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) return null;

    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return null;

    const currentStatusDef = pipeline.statuses.find((s) => s.name === task.status);

    // Run independent queries in parallel
    const [allTransitions, recentEvents, agentRuns] = await Promise.all([
      this.pipelineEngine.getAllTransitions(task),
      this.taskEventLog.getEvents({
        taskId,
        since: Date.now() - 86400000, // last 24 hours
      }),
      this.agentRunStore.getRunsForTask(taskId),
    ]);

    // Pre-check guards for manual transitions
    for (const t of allTransitions.manual) {
      t.guardStatus = await this.pipelineEngine.checkGuards(task, t.to, 'manual') ?? undefined;
    }

    const hookFailures: HookFailureRecord[] = recentEvents
      .filter((e) => e.category === 'system' && (e.severity === 'error' || e.severity === 'warning')
        && e.data?.hook && typeof e.data.hook === 'string')
      .map((e) => {
        const retryableHooks = ['merge_pr', 'push_and_create_pr', 'advance_phase', 'delete_worktree'];
        return {
          id: e.id,
          taskId: e.taskId,
          hookName: e.data.hook as string,
          error: (e.data.error as string) ?? e.message,
          policy: (e.data.policy as HookFailureRecord['policy']) ?? 'best_effort',
          transitionFrom: (e.data.fromStatus as string) ?? '',
          transitionTo: (e.data.toStatus as string) ?? '',
          timestamp: e.createdAt,
          retryable: retryableHooks.includes(e.data.hook as string),
        };
      });

    // Agent state
    const latestRun = agentRuns[0] ?? null;
    const failedRuns = agentRuns.filter((r) => r.status === 'failed' || r.status === 'cancelled');
    const hasRunningAgent = agentRuns.some((r) => r.status === 'running');

    // Stuck detection
    const isAgentPhase = currentStatusDef?.category === 'agent_running';
    let isStuck = false;
    let stuckReason: string | undefined;

    if (isAgentPhase && !hasRunningAgent) {
      // Agent phase but no agent running
      const isFinalizing = latestRun?.status === 'completed' && latestRun.completedAt != null
        && (Date.now() - latestRun.completedAt) < 30000;
      if (!isFinalizing) {
        isStuck = true;
        if (latestRun?.status === 'failed') {
          stuckReason = `Agent failed: ${latestRun.error ?? 'unknown error'}`;
        } else {
          stuckReason = 'Agent phase but no agent is running';
        }
      }
    }

    // Check for done + pending phases with failed advance_phase
    if (currentStatusDef?.category === 'terminal' && task.phases) {
      const pendingPhases = task.phases.filter((p) => p.status === 'pending');
      if (pendingPhases.length > 0) {
        const advanceFailure = hookFailures.find((f) => f.hookName === 'advance_phase');
        if (advanceFailure) {
          isStuck = true;
          stuckReason = `Phase advance failed: ${advanceFailure.error}`;
        }
      }
    }

    return {
      taskId,
      currentStatus: task.status,
      statusMeta: {
        label: currentStatusDef?.label ?? task.status,
        category: currentStatusDef?.category,
        isFinal: currentStatusDef?.isFinal,
        color: currentStatusDef?.color,
      },
      allTransitions,
      recentHookFailures: hookFailures,
      phases: task.phases,
      activePhaseIndex: getActivePhaseIndex(task.phases),
      agentState: {
        hasRunningAgent,
        lastRunStatus: latestRun?.status ?? null,
        lastRunError: latestRun?.error ?? null,
        totalFailedRuns: failedRuns.length,
      },
      isStuck,
      stuckReason,
    };
  }

  async retryHook(taskId: string, hookName: string, transitionFrom?: string, transitionTo?: string): Promise<HookRetryResult> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) return { success: false, hookName, error: `Task not found: ${taskId}` };

    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return { success: false, hookName, error: `Pipeline not found: ${task.pipelineId}` };

    // Find the transition that would have this hook
    let transition: Transition | undefined;
    if (transitionFrom && transitionTo) {
      transition = pipeline.transitions.find(
        (t) => (t.from === transitionFrom || t.from === '*') && t.to === transitionTo
          && t.hooks?.some((h) => h.name === hookName),
      );
    }
    if (!transition) {
      // Fallback: search all transitions for this hook
      transition = pipeline.transitions.find(
        (t) => t.hooks?.some((h) => h.name === hookName),
      );
    }
    if (!transition) {
      return { success: false, hookName, error: `No transition found with hook "${hookName}"` };
    }

    const result = await this.pipelineEngine.retryHook(task, hookName, transition, {
      trigger: 'manual',
      data: { retry: true },
    });

    if (result.success) {
      await this.activityLog.log({
        action: 'system',
        entityType: 'task',
        entityId: taskId,
        summary: `Retried hook "${hookName}" successfully`,
        data: { hookName },
      });
    }

    return result;
  }

  async advancePhase(taskId: string): Promise<TransitionResult> {
    const task = await this.taskStore.getTask(taskId);
    if (!task) return { success: false, error: `Task not found: ${taskId}` };

    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
    if (!pipeline) return { success: false, error: `Pipeline not found: ${task.pipelineId}` };

    // Find the advance_phase hook's transition (done -> implementing, trigger: system)
    const advanceTransition = pipeline.transitions.find(
      (t) => t.trigger === 'system' && t.hooks?.some((h) => h.name === 'advance_phase'),
    );

    if (!advanceTransition) {
      // No system transition with advance_phase hook — try to manually invoke the hook
      // via the done -> implementing transition
      const systemTransition = pipeline.transitions.find(
        (t) => t.from === task.status && t.trigger === 'system',
      );
      if (systemTransition) {
        return this.pipelineEngine.executeTransition(task, systemTransition.to, {
          trigger: 'system',
          data: { reason: 'manual_advance_phase' },
        });
      }
      await this.taskEventLog.log({
        taskId,
        category: 'system',
        severity: 'warning',
        message: `No advance_phase transition found in pipeline "${task.pipelineId}" from status "${task.status}"`,
        data: { pipelineId: task.pipelineId, currentStatus: task.status },
      });
      return { success: false, error: 'No advance_phase transition found in pipeline' };
    }

    // Trigger the transition that has the advance_phase hook (typically done -> done for advance_phase,
    // but the hook itself triggers done -> implementing internally)
    // We directly invoke the advance_phase hook's logic by finding a matching system transition
    const matchingTransition = pipeline.transitions.find(
      (t) => (t.from === task.status || t.from === '*') && t.trigger === 'system'
        && t.hooks?.some((h) => h.name === 'advance_phase'),
    );

    if (!matchingTransition) {
      await this.taskEventLog.log({
        taskId,
        category: 'system',
        severity: 'warning',
        message: `No system transition from "${task.status}" with advance_phase hook in pipeline "${task.pipelineId}"`,
        data: { pipelineId: task.pipelineId, currentStatus: task.status },
      });
      return { success: false, error: `No system transition from "${task.status}" with advance_phase hook` };
    }

    const result = await this.pipelineEngine.executeTransition(task, matchingTransition.to, {
      trigger: 'system',
      data: { reason: 'manual_advance_phase' },
    });

    if (result.success) {
      await this.activityLog.log({
        action: 'transition',
        entityType: 'task',
        entityId: taskId,
        summary: `Manually advanced phase for task`,
        data: { fromStatus: task.status, toStatus: matchingTransition.to },
      });
    }

    return result;
  }

  async mergePR(taskId: string): Promise<TransitionResult> {
    const artifacts = await this.taskArtifactStore.getArtifactsForTask(taskId, 'pr');
    if (artifacts.length === 0) {
      return { success: false, error: `No PR artifact found for task: ${taskId}` };
    }

    const mergeTask = await this.taskStore.getTask(taskId);
    if (!mergeTask) {
      return { success: false, error: `Task not found: ${taskId}` };
    }
    const project = await this.projectStore.getProject(mergeTask.projectId);
    if (!project?.path) {
      return { success: false, error: `Project ${mergeTask.projectId} has no path configured` };
    }
    const scmPlatform = this.createScmPlatform(project.path);

    const prUrl = artifacts[artifacts.length - 1].data.url as string;
    try {
      await scmPlatform.mergePR(prUrl);
    } catch (err) {
      return { success: false, error: `Failed to merge PR: ${err instanceof Error ? err.message : String(err)}` };
    }

    await this.activityLog.log({
      action: 'transition',
      entityType: 'task',
      entityId: taskId,
      summary: `Merged PR: ${prUrl}`,
    });

    // Try to transition task to a final status if pipeline supports it
    const task = await this.taskStore.getTask(taskId);
    if (task) {
      const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
      const finalNames = new Set(pipeline?.statuses.filter((s) => s.isFinal).map((s) => s.name) ?? []);
      const transitions = await this.pipelineEngine.getValidTransitions(task, 'manual');
      const doneTransition = transitions.find((t) => finalNames.has(t.to));
      if (doneTransition) {
        await this.pipelineEngine.executeTransition(task, doneTransition.to, { trigger: 'manual' });
      }
    }

    return { success: true };
  }

  private formatQASummary(questions: unknown, answers: Record<string, unknown>): string {
    const qs = Array.isArray(questions) ? questions as Array<Record<string, unknown>> : [];
    const answerList = (answers as { answers?: QuestionResponse[] })?.answers ?? [];

    // Legacy plain-text response format
    if (qs.length === 0 && answerList.length === 0) {
      const plainAnswer = (answers as { answer?: string })?.answer;
      if (plainAnswer) return `The user responded: ${plainAnswer}`;
      return 'The user responded to the agent prompt.';
    }

    // Fallback responses (no structured questions, but has answer items)
    if (qs.length === 0 && answerList.length > 0) {
      for (const a of answerList) {
        if (a.answer) return `The user responded: ${a.answer}`;
      }
      return 'The user responded to the agent prompt.';
    }

    const lines = ['The user answered your questions:'];
    for (const q of qs) {
      const a = answerList.find(ar => ar.questionId === q.id);
      lines.push('', `**Q: ${q.question}**`);
      if (q.context) lines.push(`Context: ${q.context}`);
      if (a?.selectedOptionId) {
        const options = Array.isArray(q.options) ? q.options as Array<Record<string, unknown>> : [];
        const opt = options.find(o => o.id === a.selectedOptionId);
        lines.push(`Selected: ${opt?.label ?? a.selectedOptionId}`);
      }
      if (a?.answer) lines.push(`Answer: ${a.answer}`);
      if (a?.customText) lines.push(`Notes: ${a.customText}`);
    }
    return lines.join('\n');
  }

  private async cleanupWorktree(task: Task): Promise<void> {
    try {
      const project = await this.projectStore.getProject(task.projectId);
      if (!project?.path) return;
      const wm = this.createWorktreeManager(project.path);
      const worktree = await wm.get(task.id);
      if (!worktree) return;
      const branch = worktree.branch;
      if (worktree.locked) await wm.unlock(task.id);
      await wm.delete(task.id);

      // Clean up the remote branch (best-effort)
      if (branch) {
        try {
          const gitOps = this.createGitOps(project.path);
          await gitOps.deleteRemoteBranch(branch);
        } catch {
          // Remote branch may not exist — safe to ignore
        }
      }
    } catch {
      // Best-effort cleanup — don't block the operation
    }
  }
}
