import React, { useMemo } from 'react';
import { KanbanColumn } from './KanbanColumn';
import type { Task, Pipeline } from '../../../shared/types';
import type { PipelineMap } from '../../pages/KanbanPage';

interface KanbanBoardProps {
  tasks: Task[];
  pipeline: Pipeline;
  pipelineMap: PipelineMap;
  loading: boolean;
  error: Error | null;
  collapsedColumns: string[];
  onToggleColumnCollapse: (columnId: string) => void;
  onStatusChange: (taskId: string, newStatus: string) => Promise<void>;
  sortBy: 'priority' | 'created' | 'updated' | 'title';
  sortDirection: 'asc' | 'desc';
  onSortChange?: (field: 'priority' | 'created' | 'updated' | 'title', direction: 'asc' | 'desc') => void;
}

export function KanbanBoard({
  tasks,
  pipeline,
  pipelineMap,
  loading,
  error,
  collapsedColumns,
  onToggleColumnCollapse,
  onStatusChange,
  sortBy,
  sortDirection,
  onSortChange: _onSortChange,
}: KanbanBoardProps) {
  // Group tasks by status
  const tasksByStatus = useMemo(() => {
    const grouped = new Map<string, Task[]>();

    // Initialize all statuses from the pipeline
    pipeline.statuses.forEach(status => {
      grouped.set(status.name, []);
    });

    // Assign tasks to their status groups
    tasks.forEach(task => {
      const statusTasks = grouped.get(task.status);
      if (statusTasks) {
        statusTasks.push(task);
      }
    });

    return grouped;
  }, [tasks, pipeline]);

  if (loading && tasks.length === 0) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {pipeline.statuses.map((status) => (
            <div key={status.name} className="animate-pulse">
              <div className="h-10 bg-muted rounded mb-2" />
              <div className="space-y-2">
                <div className="h-24 bg-muted rounded" />
                <div className="h-24 bg-muted rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-destructive mb-2">Failed to load tasks</p>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        {pipeline.statuses.map((status) => (
          <KanbanColumn
            key={status.name}
            status={status}
            tasks={tasksByStatus.get(status.name) || []}
            pipeline={pipeline}
            pipelineMap={pipelineMap}
            collapsed={collapsedColumns.includes(status.name)}
            onToggleCollapse={() => onToggleColumnCollapse(status.name)}
            onStatusChange={onStatusChange}
            sortBy={sortBy}
            sortDirection={sortDirection}
          />
        ))}
      </div>
    </div>
  );
}