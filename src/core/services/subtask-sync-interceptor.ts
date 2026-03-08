import type { AgentChatMessage, Subtask, SubtaskStatus, ImplementationPhase } from '../../shared/types';
import type { ITaskStore } from '../interfaces/task-store';

/**
 * Intercepts agent onMessage events to sync subtask status changes
 * from SDK tool_use events (TodoWrite, TaskCreate, TaskUpdate) back
 * to the task store in real time.
 */
export class SubtaskSyncInterceptor {
  private currentSubtasks: Subtask[];
  private readonly sdkTaskIdToSubtaskName = new Map<string, string>();

  constructor(
    private taskStore: ITaskStore,
    private taskId: string,
    private phases: ImplementationPhase[] | null,
    private activePhaseIndex: number,
    private isMultiPhase: boolean,
    initialSubtasks: Subtask[],
    private onLog: (message: string) => void,
  ) {
    this.currentSubtasks = [...initialSubtasks];
  }

  /**
   * Process an agent message, syncing subtask status when applicable.
   * Call this before forwarding the message to any downstream handler.
   */
  handleMessage(msg: AgentChatMessage): void {
    if (msg.type !== 'tool_use') return;

    try {
      if (msg.toolName === 'TodoWrite') {
        this.handleTodoWrite(msg);
      } else if (msg.toolName === 'TaskCreate') {
        this.handleTaskCreate(msg);
      } else if (msg.toolName === 'TaskUpdate') {
        this.handleTaskUpdate(msg);
      }
    } catch (err) {
      this.onLog(`Subtask sync error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private handleTodoWrite(msg: AgentChatMessage & { type: 'tool_use' }): void {
    const parsed = JSON.parse(msg.input);
    const todos: Array<{ content?: string; subject?: string; status?: string }> = parsed.todos ?? parsed;
    if (!Array.isArray(todos)) return;

    // Map the agent's todo list directly to subtasks
    const agentSubtasks: Subtask[] = todos.map(todo => ({
      name: (todo.content ?? todo.subject ?? '').trim(),
      status: mapSdkStatus(todo.status ?? '') ?? 'open',
    })).filter(s => s.name.length > 0);

    // Keep DONE subtasks from previous syncs that the agent hasn't re-listed
    // (prevents duplicates for within-run updates where agent re-sends its own completed items)
    const agentNames = new Set(agentSubtasks.map(s => s.name.trim().toLowerCase()));
    const preservedDone = this.currentSubtasks.filter(
      s => s.status === 'done' && !agentNames.has(s.name.trim().toLowerCase())
    );

    this.currentSubtasks = [...preservedDone, ...agentSubtasks];
    this.persistSubtaskChanges();
  }

  private handleTaskCreate(msg: AgentChatMessage & { type: 'tool_use' }): void {
    const parsed = JSON.parse(msg.input);
    const subject = (parsed.subject ?? parsed.description ?? '').trim().toLowerCase();
    const match = this.currentSubtasks.find(s => s.name.trim().toLowerCase() === subject);
    if (match && msg.toolId) {
      this.sdkTaskIdToSubtaskName.set(msg.toolId, match.name);
    }
  }

  private handleTaskUpdate(msg: AgentChatMessage & { type: 'tool_use' }): void {
    const parsed = JSON.parse(msg.input);
    const sdkTaskId = parsed.taskId ?? parsed.id ?? '';
    const subtaskName = this.sdkTaskIdToSubtaskName.get(sdkTaskId);
    if (!subtaskName) return;

    const mappedStatus = mapSdkStatus(parsed.status ?? '');
    if (!mappedStatus) return;

    const idx = this.currentSubtasks.findIndex(s => s.name === subtaskName);
    if (idx !== -1 && this.currentSubtasks[idx].status !== mappedStatus) {
      this.currentSubtasks[idx] = { ...this.currentSubtasks[idx], status: mappedStatus };
      this.persistSubtaskChanges();
    }
  }

  private persistSubtaskChanges(): void {
    if (this.isMultiPhase && this.activePhaseIndex >= 0 && this.phases) {
      if (this.activePhaseIndex >= this.phases.length) {
        this.onLog(`persistSubtaskChanges: phase index ${this.activePhaseIndex} out of bounds (${this.phases.length} phases)`);
        this.taskStore.updateTask(this.taskId, { subtasks: [...this.currentSubtasks] }).catch((err) => {
          this.onLog(`Failed to persist subtask sync: ${err instanceof Error ? err.message : String(err)}`);
        });
        return;
      }
      const updatedPhases = [...this.phases];
      updatedPhases[this.activePhaseIndex] = {
        ...updatedPhases[this.activePhaseIndex],
        subtasks: [...this.currentSubtasks],
      };
      this.taskStore.updateTask(this.taskId, { phases: updatedPhases }).catch((err) => {
        this.onLog(`Failed to persist subtask sync: ${err instanceof Error ? err.message : String(err)}`);
      });
    } else {
      this.taskStore.updateTask(this.taskId, { subtasks: [...this.currentSubtasks] }).catch((err) => {
        this.onLog(`Failed to persist subtask sync: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }
}

/** Maps SDK task statuses to our SubtaskStatus enum. */
export function mapSdkStatus(sdkStatus: string): SubtaskStatus | null {
  switch (sdkStatus) {
    case 'pending': return 'open';
    case 'in_progress': return 'in_progress';
    case 'completed': return 'done';
    default: return null;
  }
}
