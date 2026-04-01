import React, { useMemo } from 'react';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import { buildStatusPositionMap } from './task-helpers';
import type { Task, Pipeline } from '../../../shared/types';

interface TaskStatusSummaryProps {
  tasks: Task[];
  pipelineMap: Map<string, Pipeline>;
  /** Currently active status filter (if any). */
  activeStatus?: string;
  /** Called when a status chip is clicked. Clicking the active chip clears the filter. */
  onStatusClick?: (status: string | '') => void;
}

export function TaskStatusSummary({ tasks, pipelineMap, activeStatus, onStatusClick }: TaskStatusSummaryProps) {
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    }
    // Sort by pipeline position
    const posMap = buildStatusPositionMap(pipelineMap);
    const sorted = new Map(
      Array.from(counts.entries()).sort(([a], [b]) => {
        const posA = posMap.get(a) ?? Infinity;
        const posB = posMap.get(b) ?? Infinity;
        return posA - posB;
      }),
    );
    return sorted;
  }, [tasks, pipelineMap]);

  if (tasks.length === 0) return null;

  // Pick the first pipeline for badge rendering
  const firstPipeline = tasks.length > 0 ? pipelineMap.get(tasks[0].pipelineId) ?? null : null;
  const isClickable = !!onStatusClick;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
      <span className="tabular-nums">{tasks.length} task{tasks.length !== 1 ? 's' : ''}:</span>
      {Array.from(statusCounts.entries()).map(([status, count]) => {
        const isActive = activeStatus === status;
        return (
          <button
            key={status}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors ${
              isClickable
                ? isActive
                  ? 'bg-primary/15 ring-1 ring-primary/40 cursor-pointer'
                  : 'hover:bg-accent cursor-pointer'
                : ''
            }`}
            onClick={() => {
              if (onStatusClick) {
                onStatusClick(isActive ? '' : status);
              }
            }}
            disabled={!isClickable}
            title={isClickable ? (isActive ? 'Click to clear filter' : `Filter by "${status}"`) : undefined}
          >
            <PipelineBadge status={status} pipeline={firstPipeline} />
            <span className="tabular-nums text-xs">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
