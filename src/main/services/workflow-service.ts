import type {
  Task,
  TaskCreateInput,
  TaskUpdateInput,
  TransitionResult,
  AgentRun,
  AgentMode,
  PendingPrompt,
  DashboardStats,
} from '../../shared/types';
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
import type { IWorkflowService } from '../interfaces/workflow-service';

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
    private scmPlatform: IScmPlatform,
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
    const task = await this.taskStore.updateTask(id, input);
    if (task) {
      await this.activityLog.log({
        action: 'update',
        entityType: 'task',
        entityId: id,
        summary: `Updated task: ${task.title}`,
      });
    }
    return task;
  }

  async deleteTask(id: string): Promise<boolean> {
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
    }

    return result;
  }

  async startAgent(taskId: string, mode: AgentMode, agentType: string = 'scripted'): Promise<AgentRun> {
    await this.activityLog.log({
      action: 'agent_start',
      entityType: 'agent_run',
      entityId: taskId,
      summary: `Starting ${agentType} agent in ${mode} mode`,
      data: { agentType, mode },
    });

    const run = await this.agentService.execute(taskId, mode, agentType);

    await this.activityLog.log({
      action: 'agent_complete',
      entityType: 'agent_run',
      entityId: run.id,
      summary: `Agent completed with status: ${run.status}`,
      data: { agentRunId: run.id, status: run.status, outcome: run.outcome },
    });

    return run;
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

    // Try info_provided transition
    const task = await this.taskStore.getTask(prompt.taskId);
    if (task) {
      const transitions = await this.pipelineEngine.getValidTransitions(task, 'agent');
      const match = transitions.find((t) => t.agentOutcome === 'info_provided');
      if (match) {
        await this.pipelineEngine.executeTransition(task, match.to, {
          trigger: 'agent',
          data: { outcome: 'info_provided' },
        });
      }
    }

    return prompt;
  }

  async getDashboardStats(): Promise<DashboardStats> {
    const projects = await this.projectStore.listProjects();
    const tasks = await this.taskStore.listTasks({});
    const activeRuns = await this.agentRunStore.getActiveRuns();
    const recentActivity = await this.activityLog.getEntries({ since: Date.now() - 86400000 });

    const tasksByStatus: Record<string, number> = {};
    for (const t of tasks) {
      tasksByStatus[t.status] = (tasksByStatus[t.status] || 0) + 1;
    }

    return {
      projectCount: projects.length,
      totalTasks: tasks.length,
      tasksByStatus,
      activeAgentRuns: activeRuns.length,
      recentActivityCount: recentActivity.length,
    };
  }

  async mergePR(taskId: string): Promise<void> {
    const artifacts = await this.taskArtifactStore.getArtifactsForTask(taskId, 'pr');
    if (artifacts.length === 0) throw new Error(`No PR artifact found for task: ${taskId}`);

    const prUrl = artifacts[0].data.url as string;
    await this.scmPlatform.mergePR(prUrl);

    await this.activityLog.log({
      action: 'transition',
      entityType: 'task',
      entityId: taskId,
      summary: `Merged PR: ${prUrl}`,
    });

    // Try to transition task if pipeline supports it
    const task = await this.taskStore.getTask(taskId);
    if (task) {
      const transitions = await this.pipelineEngine.getValidTransitions(task, 'manual');
      const doneTransition = transitions.find((t) => {
        // Look for a transition to a final-looking status
        return t.to === 'done' || t.to === 'resolved' || t.to === 'closed';
      });
      if (doneTransition) {
        await this.pipelineEngine.executeTransition(task, doneTransition.to, { trigger: 'manual' });
      }
    }
  }
}
