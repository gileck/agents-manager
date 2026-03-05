import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Eye, GripVertical } from 'lucide-react';
import { Card } from '../ui/card';
import { getTagColor, rgba } from '../../utils/kanban-colors';
import type { Task } from '../../../shared/types';
import type { ColumnColorTheme } from '../../utils/kanban-colors';

interface KanbanCardProps {
  task: Task;
  onClick?: (event: React.MouseEvent) => void;
  isSelected?: boolean;
  columnColor?: ColumnColorTheme;
}

const PRIORITY_COLORS: Record<number, string> = {
  0: '#ef4444', // P0 — red
  1: '#f59e0b', // P1 — amber
};

export const KanbanCard = React.memo(function KanbanCard({ task, onClick, isSelected, columnColor }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: {
      type: 'task',
      task,
    },
  });

  const accentHex = columnColor?.accentColor ?? '#6366f1';

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    opacity: isDragging ? 0.5 : 1,
    borderLeftWidth: '3px',
    borderLeftColor: accentHex,
    backgroundColor: rgba(accentHex, 0.03),
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick(e);
    }
  };

  const priorityDot = PRIORITY_COLORS[task.priority];
  const hasTags = task.tags && task.tags.length > 0;
  const isReview = task.status.endsWith('_review');
  const hasBottomRow = hasTags || task.assignee || isReview;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`p-2 transition-all duration-200 hover:translate-y-[-1px] hover:shadow-md ${isDragging ? 'cursor-grabbing shadow-lg' : 'cursor-grab'} ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''} [&[data-kanban-selected=true]]:ring-2 [&[data-kanban-selected=true]]:ring-primary`}
      data-task-id={task.id}
    >
      <div className="flex gap-1.5">
        <div
          {...listeners}
          {...attributes}
          className="flex items-start pt-0.5 cursor-grab active:cursor-grabbing opacity-40 hover:opacity-100 transition-opacity"
        >
          <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0 cursor-pointer" onClick={handleClick}>
          <div className="flex items-start gap-1">
            {priorityDot && (
              <span
                className="shrink-0 mt-1 rounded-full"
                style={{ width: '6px', height: '6px', backgroundColor: priorityDot }}
              />
            )}
            <span
              className="font-medium text-sm leading-snug"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {task.title}
            </span>
          </div>
          {hasBottomRow && (
            <div className="flex items-center gap-1 mt-1">
              {isReview && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium text-violet-500"
                  title={task.status}
                >
                  <Eye className="w-3 h-3" />
                  Review
                </span>
              )}
              {hasTags && task.tags.map((tag) => {
                const tagColor = getTagColor(tag);
                return (
                  <span
                    key={tag}
                    className="inline-flex items-center text-[10px] font-medium px-1.5 py-0 rounded-full border leading-relaxed"
                    style={tagColor.style}
                  >
                    {tag}
                  </span>
                );
              })}
              {task.assignee && (
                <div
                  className="shrink-0 flex items-center justify-center text-[8px] font-bold uppercase ml-auto"
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    backgroundColor: accentHex,
                    color: '#fff',
                  }}
                >
                  {task.assignee.charAt(0)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
});
