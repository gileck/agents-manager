import type { DebugTimelineEntry } from '../../shared/types';
import type { TimelineService } from './timeline/timeline-service';

export interface ErrorAggregationFilter {
  taskId?: string;
  correlationId?: string;
}

/**
 * Cross-store error aggregation service.
 *
 * Provides a unified view of all error-severity entries across task_events,
 * app_debug_log, agent_runs, and transition_history for a given taskId
 * or correlationId. Leverages the existing TimelineService for multi-source
 * aggregation rather than duplicating queries.
 */
export class ErrorAggregationService {
  constructor(private timelineService: TimelineService) {}

  /**
   * Fetch all error-severity timeline entries for a task, optionally
   * filtered by correlationId to show only errors from a single transition chain.
   */
  getErrors(filter: ErrorAggregationFilter): DebugTimelineEntry[] {
    if (!filter.taskId) return [];

    const allEntries = this.timelineService.getTimeline(filter.taskId);
    let errors = allEntries.filter((e) => e.severity === 'error');

    if (filter.correlationId) {
      errors = errors.filter((e) => e.correlationId === filter.correlationId);
    }

    return errors;
  }

  /**
   * Get all timeline entries grouped by correlationId for a given task.
   * Returns entries that have a correlationId, grouped into arrays.
   */
  getCorrelationGroups(taskId: string): Record<string, DebugTimelineEntry[]> {
    const allEntries = this.timelineService.getTimeline(taskId);
    const groups: Record<string, DebugTimelineEntry[]> = {};

    for (const entry of allEntries) {
      if (entry.correlationId) {
        if (!groups[entry.correlationId]) {
          groups[entry.correlationId] = [];
        }
        groups[entry.correlationId].push(entry);
      }
    }

    return groups;
  }
}
