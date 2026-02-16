import type { TaskEvent, TaskEventCreateInput, TaskEventFilter } from '../../shared/types';

export interface ITaskEventLog {
  log(input: TaskEventCreateInput): TaskEvent;
  getEvents(filter?: TaskEventFilter): TaskEvent[];
}
