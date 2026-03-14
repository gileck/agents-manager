import type { ITimelineStore } from '../../../../core/interfaces/timeline-store';
import type { DebugTimelineEntry } from '../../../../shared/types';
import type { ITimelineSource } from '../types';

export class PromptSource implements ITimelineSource {
  constructor(private store: ITimelineStore) {}

  getEntries(taskId: string): DebugTimelineEntry[] {
    return this.store.getPromptEntries(taskId);
  }
}
