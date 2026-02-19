import type { DebugTimelineEntry } from '../../../shared/types';
import type { ITimelineSource } from './types';

export interface TimelineOptions {
  limit?: number;
  before?: number;
}

export class TimelineService {
  constructor(private sources: ITimelineSource[]) {}

  getTimeline(taskId: string, options?: TimelineOptions): DebugTimelineEntry[] {
    // Collect entries from all sources
    const allEntries: DebugTimelineEntry[] = [];
    for (const source of this.sources) {
      allEntries.push(...source.getEntries(taskId));
    }

    // Deduplicate via id (djb2 hash of timestamp+source+title)
    const seen = new Set<string>();
    const deduped: DebugTimelineEntry[] = [];
    for (const entry of allEntries) {
      const key = entry.id ?? `${entry.timestamp}-${entry.source}-${entry.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(entry);
      }
    }

    // Sort by timestamp descending
    deduped.sort((a, b) => b.timestamp - a.timestamp);

    // Keyset pagination: filter entries before the cursor timestamp
    let result = deduped;
    if (options?.before !== undefined) {
      result = result.filter((e) => e.timestamp < options.before!);
    }

    // Apply limit
    if (options?.limit !== undefined && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    return result;
  }
}
