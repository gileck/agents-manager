import type { TaskEvent, TaskEventCreateInput, TaskEventFilter } from '../../shared/types';

export interface ITaskEventLog {
  log(input: TaskEventCreateInput): Promise<TaskEvent>;
  getEvents(filter?: TaskEventFilter): Promise<TaskEvent[]>;
}
