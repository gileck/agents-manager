import React, { useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { KanbanCard } from './KanbanCard';
import { sortTasks } from '../tasks/task-helpers';
import type { Task, Pipeline, PipelineStatus } from '../../../shared/types';
import type { PipelineMap } from '../../pages/KanbanPage';

interface KanbanColumnProps {
  status: PipelineStatus;
  tasks: Task[];
  pipeline: Pipeline;
  pipelineMap: PipelineMap;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onStatusChange: (taskId: string, newStatus: string) => Promise<void>;
  sortBy: 'priority' | 'created' | 'updated' | 'title';
  sortDirection: 'asc' | 'desc';
}

export function KanbanColumn({
  status,
  tasks,
  pipeline,
  pipelineMap,
  collapsed,
  onToggleCollapse,
  onStatusChange,
  sortBy,
  sortDirection,
}: KanbanColumnProps) {
  // Sort tasks within the column
  const sortedTasks = useMemo(() => {
    return sortTasks(tasks, sortBy, sortDirection);
  }, [tasks, sortBy, sortDirection]);

  // Get status color
  const statusColor = status.color || '#666';

  return (
    <div className="bg-card rounded-lg border border-border shadow-sm flex flex-col max-h-[calc(100vh-200px)]">
      {/* Column Header */}
      <div
        className="p-3 border-b border-border cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggleCollapse}
        style={{ borderTopColor: statusColor, borderTopWidth: '3px' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCollapse();
              }}
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
            <h3 className="font-semibold text-sm">{status.label}</h3>
          </div>
          <Badge variant="secondary" className="text-xs">
            {tasks.length}
          </Badge>
        </div>
      </div>

      {/* Column Content */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sortedTasks.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">No tasks</p>
            </div>
          ) : (
            sortedTasks.map((task) => (
              <KanbanCard
                key={task.id}
                task={task}
                pipeline={pipeline}
                pipelineMap={pipelineMap}
                onStatusChange={onStatusChange}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}