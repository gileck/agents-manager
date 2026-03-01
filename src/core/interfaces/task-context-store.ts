import type { TaskContextEntry, TaskContextEntryCreateInput } from '../../shared/types';

export interface ITaskContextStore {
  addEntry(input: TaskContextEntryCreateInput): Promise<TaskContextEntry>;
  getEntriesForTask(taskId: string): Promise<TaskContextEntry[]>;
}
