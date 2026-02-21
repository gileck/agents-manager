import React, { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
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
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // Configure drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );
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

  // Handle drag start
  const handleDragStart = (event: DragStartEvent) => {
    const taskId = event.active.id as string;
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      setActiveTask(task);
    }
  };

  // Handle drag end
  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      setActiveTask(null);
      return;
    }

    const taskId = active.id as string;
    const newStatus = over.id as string;

    // Find the task that was dragged
    const task = tasks.find(t => t.id === taskId);

    if (task && task.status !== newStatus) {
      try {
        await onStatusChange(taskId, newStatus);
      } catch (error) {
        console.error('Failed to update task status:', error);
      }
    }

    setActiveTask(null);
  };

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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
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
      <DragOverlay>
        {activeTask && (
          <KanbanCard
            task={activeTask}
            pipeline={pipeline}
            pipelineMap={pipelineMap}
            onStatusChange={onStatusChange}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}