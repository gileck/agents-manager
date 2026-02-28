import React, { useRef, useState, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { KanbanCard } from './KanbanCard';
import { KanbanEmptyState } from './KanbanEmptyState';
import { useVirtualizedKanban, useScrollPosition } from '../../hooks/useVirtualizedKanban';
import { rgba } from '../../utils/kanban-colors';
import type { Task, KanbanColumn as KanbanColumnType } from '../../../shared/types';
import type { ColumnColorTheme } from '../../utils/kanban-colors';

interface VirtualizedKanbanColumnProps {
  column: KanbanColumnType;
  tasks: Task[];
  onCardClick: (task: Task, event: React.MouseEvent) => void;
  selectedTaskIds?: Set<string>;
  itemHeight?: number;
  threshold?: number;
  colorTheme: ColumnColorTheme;
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
  itemHeight = 80,
  threshold = 50,
  colorTheme,
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

  const columnStyle: React.CSSProperties = {
    minWidth: '280px',
    maxWidth: '320px',
    ...(isOver ? colorTheme.dropZoneStyle : {}),
  };

  return (
    <div
      className={`flex flex-col h-full rounded-xl border transition-all duration-200`}
      style={columnStyle}
      data-kanban-column={column.id}
    >
      {/* Column Header */}
      <div
        className="px-4 py-3 rounded-t-xl"
        style={{ ...colorTheme.headerStyle, borderBottom: `2px solid ${rgba(colorTheme.accentColor, 0.15)}` }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="rounded-full"
              style={{ width: '10px', height: '10px', backgroundColor: colorTheme.accentColor }}
            />
            <h3 className="font-semibold text-sm">{column.title}</h3>
          </div>
          <span
            className="text-xs font-bold px-2 py-0.5 rounded-full"
            style={colorTheme.badgeStyle}
          >
            {tasks.length}
          </span>
        </div>
        {column.wip && tasks.length > column.wip && (
          <div className="text-xs text-destructive mt-1 font-medium">
            WIP limit exceeded ({tasks.length}/{column.wip})
          </div>
        )}
      </div>

      {/* Column Content */}
      <div
        ref={(node) => {
          setNodeRef(node);
          containerRef.current = node;
        }}
        className="flex-1 overflow-y-auto p-2"
        style={{ position: 'relative', backgroundColor: rgba(colorTheme.accentColor, 0.02) }}
      >
        {tasks.length === 0 ? (
          <KanbanEmptyState variant="column" isOver={isOver} colorTheme={colorTheme} />
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
                  columnColor={colorTheme}
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
                columnColor={colorTheme}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
