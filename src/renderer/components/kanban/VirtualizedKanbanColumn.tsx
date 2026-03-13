import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { KanbanCard } from './KanbanCard';
import { KanbanEmptyState } from './KanbanEmptyState';
import { useVirtualizedKanban, useScrollPosition } from '../../hooks/useVirtualizedKanban';
import { rgba } from '../../utils/kanban-colors';
import { ChevronRight } from 'lucide-react';
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
  onToggleCollapse?: () => void;
}

/**
 * Virtualized kanban column that only renders visible cards for performance.
 * Supports collapsing to a thin vertical strip.
 * Falls back to regular rendering for small lists.
 */
export function VirtualizedKanbanColumn({
  column,
  tasks,
  onCardClick,
  selectedTaskIds = new Set(),
  itemHeight = 80,
  threshold = 20,
  colorTheme,
  onToggleCollapse,
}: VirtualizedKanbanColumnProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(600);
  const scrollTop = useScrollPosition(containerRef);
  const [atBottom, setAtBottom] = useState(false);

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

  // Track scroll position for "more tasks" indicator
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setAtBottom(isAtBottom);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // initial check
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

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

  const remainingCount = shouldVirtualize ? tasks.length - range.end : 0;

  // ---- Collapsed column ----
  if (column.collapsed) {
    return (
      <div
        ref={setNodeRef}
        className="flex flex-col items-center rounded-xl border transition-all duration-200 cursor-pointer hover:bg-accent/50"
        style={{
          flex: '0 0 40px',
          minHeight: 0,
          height: '100%',
          ...(isOver ? colorTheme.dropZoneStyle : {}),
        }}
        onClick={onToggleCollapse}
        data-kanban-column={column.id}
      >
        {/* Color dot */}
        <div
          className="rounded-full mt-3"
          style={{ width: '8px', height: '8px', backgroundColor: colorTheme.accentColor }}
        />
        {/* Count badge */}
        <span
          className="text-[10px] font-bold mt-2 px-1.5 py-0.5 rounded-full"
          style={colorTheme.badgeStyle}
        >
          {tasks.length}
        </span>
        {/* Vertical title */}
        <span
          className="text-xs font-medium mt-3 whitespace-nowrap"
          style={{
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            transform: 'rotate(180deg)',
            maxHeight: 'calc(100% - 80px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: colorTheme.accentColor,
          }}
        >
          {column.title}
        </span>
        {/* Expand icon */}
        <ChevronRight
          className="w-3.5 h-3.5 mt-auto mb-3 text-muted-foreground"
          style={{ transform: 'rotate(0deg)' }}
        />
      </div>
    );
  }

  // ---- Normal (expanded) column ----
  const columnStyle: React.CSSProperties = {
    flex: '1 1 0%',
    minWidth: '260px',
    ...(isOver ? colorTheme.dropZoneStyle : {}),
  };

  return (
    <div
      className="flex flex-col h-full rounded-xl border transition-all duration-200"
      style={{
        ...columnStyle,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)',
      }}
      data-kanban-column={column.id}
    >
      {/* Column Header */}
      <div
        className="px-3 py-2.5 rounded-t-xl cursor-pointer select-none hover:opacity-80 transition-opacity"
        style={{ ...colorTheme.headerStyle, borderBottom: `2px solid ${rgba(colorTheme.accentColor, 0.1)}` }}
        onClick={onToggleCollapse}
        title="Click to collapse"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="rounded-full"
              style={{ width: '8px', height: '8px', backgroundColor: colorTheme.accentColor }}
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
          (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }}
        className="flex-1 overflow-y-auto p-2"
        style={{ position: 'relative', backgroundColor: rgba(colorTheme.accentColor, 0.01) }}
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

      {/* Scroll indicator for remaining tasks */}
      {shouldVirtualize && !atBottom && remainingCount > 0 && (
        <div
          className="text-center text-[11px] text-muted-foreground py-1 border-t"
          style={{ backgroundColor: rgba(colorTheme.accentColor, 0.03) }}
        >
          ↓ {remainingCount} more {remainingCount === 1 ? 'task' : 'tasks'}
        </div>
      )}
    </div>
  );
}
