import type {
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TaskContextEntry,
  TransitionResult,
  AgentRun,
  AgentMode,
  RevisionReason,
  PendingPrompt,
  DashboardStats,
  AgentChatMessage,
  StopAgentResult,
} from '../../shared/types';
import { FEEDBACK_ENTRY_TYPES } from '../../shared/types';
import { analyzeRunMessages } from './run-diagnostics-analyzer';
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
import type { IDevServerManager } from '../interfaces/dev-server-manager';

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
    private devServerManager?: IDevServerManager,
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

  async startAgent(taskId: string, mode: AgentMode, agentType: string, revisionReason?: RevisionReason, onOutput?: (chunk: string) => void, onMessage?: (msg: AgentChatMessage) => void, onStatusChange?: (status: string) => void): Promise<AgentRun> {
    await this.activityLog.log({
      action: 'agent_start',
      entityType: 'agent_run',
      entityId: taskId,
      summary: `Starting ${agentType} agent in ${mode} mode`,
      data: { agentType, mode, revisionReason },
    });

    const run = await this.agentService.execute(taskId, mode, agentType, revisionReason, onOutput, onMessage, onStatusChange);
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
    const mode: AgentMode = lastRun?.mode || 'new';
    const agentType = lastRun?.agentType || 'implementor';
    // When resuming a revision run, the user is providing additional info
    const revisionReason: RevisionReason | undefined = mode === 'revision' ? 'info_provided' : undefined;

    return this.startAgent(taskId, mode, agentType, revisionReason, callbacks.onOutput, callbacks.onMessage, callbacks.onStatusChange);
  }

  async stopAgent(runId: string): Promise<StopAgentResult> {
    // Get the run to find the task before stopping
    const run = await this.agentRunStore.getRun(runId);
    await this.agentService.stop(runId);
    await this.activityLog.log({
      action: 'agent_complete',
      entityType: 'agent_run',
      entityId: runId,
      summary: 'Agent stopped',
    });

    // Build stop options for the post-stop dialog
    if (!run) return { currentStatus: '', previousStatus: null, manualTransitions: [] };

    const task = await this.taskStore.getTask(run.taskId);
    if (!task) return { currentStatus: '', previousStatus: null, manualTransitions: [] };

    const previousStatus = this.pipelineEngine.getPreviousStatus(task.id);
    const manualTransitions = await this.pipelineEngine.getValidTransitions(task, 'manual');

    return {
      currentStatus: task.status,
      previousStatus,
      manualTransitions: manualTransitions.map(t => ({ to: t.to, label: t.label ?? t.to })),
    };
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

  async addTaskFeedback(taskId: string, entryType: string, content: string, source?: string, agentRunId?: string): Promise<TaskContextEntry> {
    if (!(FEEDBACK_ENTRY_TYPES as readonly string[]).includes(entryType)) {
      throw new Error(`Invalid feedback entry type: ${entryType}. Must be one of: ${FEEDBACK_ENTRY_TYPES.join(', ')}`);
    }
    const task = await this.taskStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const entry = await this.taskContextStore.addEntry({
      taskId,
      source: source ?? 'admin',
      entryType,
      summary: content,
      agentRunId,
    });

    await this.activityLog.log({
      action: 'update',
      entityType: 'task',
      entityId: taskId,
      projectId: task.projectId,
      summary: `Added ${entryType} feedback`,
    });

    return entry;
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

  async addContextEntry(taskId: string, input: { source: string; entryType: string; summary: string; data?: Record<string, unknown> }): Promise<TaskContextEntry> {
    const entry = await this.taskContextStore.addEntry({ taskId, ...input });
    await this.activityLog.log({
      action: 'update',
      entityType: 'task',
      entityId: taskId,
      summary: `Added ${input.entryType} context entry`,
    });
    return entry;
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
      const gitOps = this.createGitOps(project.path);

      if (worktree) {
        const branch = worktree.branch;
        // Stop dev server before removing worktree (process holds file handles)
        await this.devServerManager?.stop(task.id).catch((err) => {
          this.taskEventLog.log({
            taskId: task.id, category: 'worktree', severity: 'warning',
            message: `Failed to stop dev server: ${(err as Error).message}`,
          }).catch(() => { /* best-effort logging */ });
        });
        if (worktree.locked) await wm.unlock(task.id);
        await wm.delete(task.id);

        // Clean up the remote phase/worktree branch (best-effort)
        if (branch) {
          try {
            await gitOps.deleteRemoteBranch(branch);
          } catch (branchErr) {
            const msg = branchErr instanceof Error ? branchErr.message : String(branchErr);
            if (!/not found|does not exist|couldn't find remote ref/i.test(msg)) {
              this.taskEventLog.log({
                taskId: task.id, category: 'worktree', severity: 'warning',
                message: `Failed to delete remote branch "${branch}": ${msg}`,
              }).catch(() => { /* best-effort logging */ });
            }
          }
        }
      }

      // Clean up the task integration branch for multi-phase tasks (best-effort)
      const taskBranch = (task.metadata?.taskBranch as string) || undefined;
      if (taskBranch) {
        try {
          await gitOps.deleteRemoteBranch(taskBranch);
        } catch (branchErr) {
          const msg = branchErr instanceof Error ? branchErr.message : String(branchErr);
          if (!/not found|does not exist|couldn't find remote ref/i.test(msg)) {
            this.taskEventLog.log({
              taskId: task.id, category: 'worktree', severity: 'warning',
              message: `Failed to delete remote task branch "${taskBranch}": ${msg}`,
            }).catch(() => { /* best-effort logging */ });
          }
        }
      }
    } catch (err) {
      const cleanupMsg = err instanceof Error ? err.message : String(err);
      this.taskEventLog.log({
        taskId: task.id,
        category: 'worktree',
        severity: 'warning',
        message: `cleanupWorktree failed: ${cleanupMsg}`,
        data: { error: cleanupMsg },
      }).catch(() => { /* best-effort logging */ });
    }
  }

  async computeRunDiagnostics(runId: string): Promise<AgentRun> {
    const run = await this.agentRunStore.getRun(runId);
    if (!run) throw new Error(`Agent run not found: ${runId}`);
    if (!run.messages || run.messages.length === 0) {
      throw new Error('No messages available for diagnostics');
    }
    const diagnostics = analyzeRunMessages(run.messages, run.outcome != null && run.outcome !== 'failed');
    const updated = await this.agentRunStore.updateRun(runId, { diagnostics });
    return updated!;
  }
}
