import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';

export class WorkflowReviewSupervisor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private reviewing = new Set<string>();

  constructor(
    private taskStore: ITaskStore,
    private taskContextStore: ITaskContextStore,
    private pipelineStore: IPipelineStore,
    private workflowService: IWorkflowService,
    private agentRunStore: IAgentRunStore,
    private taskEventLog: ITaskEventLog,
  ) {}

  start(intervalMs = 5 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll().catch(console.error), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      // Get all tasks in final statuses
      const allTasks = await this.taskStore.listTasks();
      const pipelines = await this.pipelineStore.listPipelines();

      // Build a set of final status names across all pipelines
      const finalStatuses = new Set<string>();
      for (const pipeline of pipelines) {
        for (const status of pipeline.statuses) {
          if (status.isFinal) {
            finalStatuses.add(status.name);
          }
        }
      }

      const doneTasks = allTasks.filter(t => finalStatuses.has(t.status));
      if (doneTasks.length === 0) return;

      // Find tasks that already have a workflow_review context entry
      const reviewedTaskIds = new Set<string>();
      for (const task of doneTasks) {
        const entries = await this.taskContextStore.getEntriesForTask(task.id);
        if (entries.some(e => e.entryType === 'workflow_review')) {
          reviewedTaskIds.add(task.id);
        }
      }

      // Build set of task IDs that have active agent runs (using task IDs, not run IDs)
      const activeRuns = await this.agentRunStore.getActiveRuns();
      const activeTaskIds = new Set(activeRuns.map(r => r.taskId));

      // Filter to un-reviewed tasks not currently being reviewed
      const candidates = doneTasks.filter(t =>
        !reviewedTaskIds.has(t.id) &&
        !this.reviewing.has(t.id) &&
        !activeTaskIds.has(t.id)
      );

      if (candidates.length === 0) return;

      // Review one task per poll cycle to avoid overload
      const task = candidates[0];
      this.reviewing.add(task.id);

      try {
        await this.taskEventLog.log({
          taskId: task.id,
          category: 'agent',
          severity: 'info',
          message: 'Starting automatic workflow review',
        });

        const run = await this.workflowService.startAgent(task.id, 'review', 'task-workflow-reviewer');

        // Don't remove from reviewing set in finally — keep it until the
        // background agent completes so the next poll cycle won't re-trigger.
        // Once complete, the context entry check will prevent future duplicates.
        this.waitAndCleanup(task.id, run.id);
      } catch (err) {
        // Only clear reviewing on start failure — agent never ran
        this.reviewing.delete(task.id);
        const errorMsg = err instanceof Error ? err.message : String(err);
        await this.taskEventLog.log({
          taskId: task.id,
          category: 'agent',
          severity: 'warning',
          message: `Failed to start workflow review: ${errorMsg}`,
          data: { error: errorMsg },
        });
      }
    } catch (err) {
      console.error('WorkflowReviewSupervisor poll error:', err);
    }
  }

  private waitAndCleanup(taskId: string, runId: string): void {
    // Poll for run completion in the background, then remove from reviewing set
    const check = setInterval(async () => {
      try {
        const run = await this.agentRunStore.getRun(runId);
        if (!run || run.status !== 'running') {
          clearInterval(check);
          this.reviewing.delete(taskId);
        }
      } catch {
        clearInterval(check);
        this.reviewing.delete(taskId);
      }
    }, 30_000);
  }
}
