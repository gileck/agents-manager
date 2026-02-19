import type { DebugTimelineEntry } from '../../../shared/types';

export interface ITimelineSource {
  getEntries(taskId: string): DebugTimelineEntry[];
}
