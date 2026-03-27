import type { Task, TaskCreateInput, TaskUpdateInput, TaskContextEntryCreateInput, DocArtifactType, Notification, TaskEventCategory, TaskEventSeverity } from '../../shared/types';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { ITaskDocStore } from '../interfaces/task-doc-store';
import type { ITaskAPI } from '../interfaces/task-api';

/**
 * TaskAPI — thin wrapper over existing stores, scoped to a single task.
 *
 * Created per agent-run in agent-service and passed to PostRunHandlers.
 * Each method auto-injects the taskId so handlers never manage it manually.
 */
export class TaskAPI implements ITaskAPI {
  constructor(
    readonly taskId: string,
    private taskStore: ITaskStore,
    private taskContextStore: ITaskContextStore,
    private taskEventLog: ITaskEventLog,
    private notificationRouter: INotificationRouter,
    private taskDocStore?: ITaskDocStore,
  ) {}

  async upsertDoc(type: DocArtifactType, content: string, summary: string | null): Promise<void> {
    if (!this.taskDocStore) return;
    await this.taskDocStore.upsert({ taskId: this.taskId, type, content, summary });
  }

  async updateTask(updates: TaskUpdateInput): Promise<void> {
    await this.taskStore.updateTask(this.taskId, updates);
  }

  async getTask(): Promise<Task | null> {
    return this.taskStore.getTask(this.taskId);
  }

  async addContextEntry(input: Omit<TaskContextEntryCreateInput, 'taskId'>): Promise<void> {
    await this.taskContextStore.addEntry({ ...input, taskId: this.taskId });
  }

  async markFeedbackAsAddressed(feedbackTypes: string[], agentRunId: string): Promise<void> {
    await this.taskContextStore.markEntriesAsAddressed(this.taskId, feedbackTypes, agentRunId);
  }

  async logEvent(input: { category: TaskEventCategory; severity: TaskEventSeverity; message: string; data?: Record<string, unknown> }): Promise<void> {
    await this.taskEventLog.log({ ...input, taskId: this.taskId });
  }

  async sendNotification(notification: Omit<Notification, 'taskId'>): Promise<void> {
    await this.notificationRouter.send({ ...notification, taskId: this.taskId });
  }

  async sendNotificationForTask(taskId: string, notification: Omit<Notification, 'taskId'>): Promise<void> {
    await this.notificationRouter.send({ ...notification, taskId });
  }

  async createTask(input: TaskCreateInput): Promise<Task> {
    return this.taskStore.createTask(input);
  }
}
