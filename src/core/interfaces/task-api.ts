import type { Task, TaskCreateInput, TaskUpdateInput, TaskContextEntryCreateInput, DocArtifactType, Notification, TaskEventCategory, TaskEventSeverity } from '../../shared/types';

/**
 * TaskAPI — the single public contract for agents to persist results.
 *
 * Each per-agent PostRunHandler receives a TaskAPI scoped to a specific task.
 * Methods mirror the underlying stores but are task-scoped (taskId is baked in)
 * so handlers never need to pass taskId explicitly.
 *
 * This replaces the centralized PostRunExtractor pattern by making each agent's
 * handler the authority on how its structured output maps to persistence operations.
 */
export interface ITaskAPI {
  /** The task ID this API is scoped to. */
  readonly taskId: string;

  // --- Document management ---

  /** Upsert a document artifact (plan, investigation_report, technical_design, etc.). */
  upsertDoc(type: DocArtifactType, content: string, summary: string | null): Promise<void>;

  // --- Task updates ---

  /** Update task fields (subtasks, phases, size, complexity, tags, metadata, etc.). */
  updateTask(updates: TaskUpdateInput): Promise<void>;

  /** Get the current task data. */
  getTask(): Promise<Task | null>;

  // --- Context entries ---

  /** Add a context entry for this task. The taskId field is auto-set. */
  addContextEntry(input: Omit<TaskContextEntryCreateInput, 'taskId'>): Promise<void>;

  /** Mark feedback entries of given types as addressed. */
  markFeedbackAsAddressed(feedbackTypes: string[], agentRunId: string): Promise<void>;

  // --- Event logging ---

  /** Log a task event. The taskId field is auto-set. */
  logEvent(input: { category: TaskEventCategory; severity: TaskEventSeverity; message: string; data?: Record<string, unknown> }): Promise<void>;

  // --- Notifications ---

  /** Send a notification. The taskId field is auto-set. */
  sendNotification(notification: Omit<Notification, 'taskId'>): Promise<void>;

  /**
   * Send a notification scoped to a different task (e.g., for newly created suggested tasks).
   * Unlike sendNotification(), the taskId is NOT auto-set — the caller provides it explicitly.
   */
  sendNotificationForTask(taskId: string, notification: Omit<Notification, 'taskId'>): Promise<void>;

  // --- Task creation (for agents that suggest follow-up tasks) ---

  /** Create a new task (e.g., suggested tasks from workflow reviewer). */
  createTask(input: TaskCreateInput): Promise<Task>;

  // --- Cross-task operations (for handlers that need to read/update other tasks) ---

  /** Get any task by its ID (not scoped to current task). Used for cross-task validation. */
  getTaskById(taskId: string): Promise<Task | null>;

  /** Update any task by its ID (not scoped to current task). Used for cross-task tagging. */
  updateTaskById(taskId: string, updates: TaskUpdateInput): Promise<void>;

  /** Log an event on any task (not scoped to current task). Used for cross-task traceability. */
  logEventForTask(taskId: string, input: { category: TaskEventCategory; severity: TaskEventSeverity; message: string; data?: Record<string, unknown> }): Promise<void>;
}
