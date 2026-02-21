import React, { useRef, useState, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Card, CardHeader, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { KanbanCard } from './KanbanCard';
import { KanbanEmptyState } from './KanbanEmptyState';
import { useVirtualizedKanban, useScrollPosition } from '../../hooks/useVirtualizedKanban';
import type { Task, KanbanColumn as KanbanColumnType } from '../../../shared/types';

interface VirtualizedKanbanColumnProps {
  column: KanbanColumnType;
  tasks: Task[];
  onCardClick: (task: Task, event: React.MouseEvent) => void;
  selectedTaskIds?: Set<string>;
  itemHeight?: number;
  threshold?: number;
}

/**
 * Virtualized kanban column that only renders visible cards for performance
 * Falls back to regular rendering for small lists
 */
export function VirtualizedKanbanColumn({
  column,
  tasks,
  onCardClick,
  selectedTaskIds = new Set(),
  itemHeight = 120, // Approximate height of a card including gap
  threshold = 50, // Use virtualization when more than 50 cards
}: VirtualizedKanbanColumnProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(600);
  const scrollTop = useScrollPosition(containerRef);

  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: {
      type: 'column',
      column,
    },
  });

  // Measure container height
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const shouldVirtualize = tasks.length > threshold;

  const range = useVirtualizedKanban({
    itemCount: tasks.length,
    itemHeight,
    containerHeight,
    scrollTop,
    overscan: 3,
  });

  // Only render visible items if virtualizing
  const visibleTasks = shouldVirtualize
    ? tasks.slice(range.start, range.end)
    : tasks;

  return (
    <Card
      className={`flex flex-col h-full min-w-[280px] max-w-[320px] transition-colors ${
        isOver ? 'ring-2 ring-primary ring-offset-2' : ''
      }`}
      data-kanban-column={column.id}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{column.title}</h3>
          <Badge variant="secondary" className="text-xs">
            {tasks.length}
          </Badge>
        </div>
        {column.wip && tasks.length > column.wip && (
          <div className="text-xs text-destructive mt-1">
            WIP limit exceeded ({tasks.length}/{column.wip})
          </div>
        )}
      </CardHeader>
      <CardContent
        ref={(node) => {
          setNodeRef(node);
          containerRef.current = node;
        }}
        className="flex-1 overflow-y-auto pt-0"
        style={{ position: 'relative' }}
      >
        {tasks.length === 0 ? (
          <KanbanEmptyState variant="column" isOver={isOver} />
        ) : shouldVirtualize ? (
          // Virtualized rendering
          <div
            style={{
              height: range.totalHeight,
              position: 'relative',
            }}
          >
            <div
              style={{
                transform: `translateY(${range.offsetY}px)`,
                position: 'absolute',
                width: '100%',
              }}
              className="space-y-2"
            >
              {visibleTasks.map((task) => (
                <KanbanCard
                  key={task.id}
                  task={task}
                  onClick={(e) => onCardClick(task, e)}
                  isSelected={selectedTaskIds.has(task.id)}
                />
              ))}
            </div>
          </div>
        ) : (
          // Non-virtualized rendering for small lists
          <div className="space-y-2">
            {tasks.map((task) => (
              <KanbanCard
                key={task.id}
                task={task}
                onClick={(e) => onCardClick(task, e)}
                isSelected={selectedTaskIds.has(task.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
