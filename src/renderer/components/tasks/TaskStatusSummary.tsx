import React, { useMemo } from 'react';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import type { Task, Pipeline } from '../../../shared/types';

interface TaskStatusSummaryProps {
  tasks: Task[];
  pipelineMap: Map<string, Pipeline>;
}

export function TaskStatusSummary({ tasks, pipelineMap }: TaskStatusSummaryProps) {
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks) {
      counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  if (tasks.length === 0) return null;

  // Pick the first pipeline for badge rendering
  const firstPipeline = tasks.length > 0 ? pipelineMap.get(tasks[0].pipelineId) ?? null : null;

  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span>{tasks.length} task{tasks.length !== 1 ? 's' : ''}:</span>
      {Array.from(statusCounts.entries()).map(([status, count]) => (
        <div key={status} className="flex items-center gap-1">
          <PipelineBadge status={status} pipeline={firstPipeline} />
          <span>{count}</span>
        </div>
      ))}
    </div>
  );
}
