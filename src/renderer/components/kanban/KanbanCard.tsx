import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Eye } from 'lucide-react';
import { Card } from '../ui/card';
import { getTagColor, getPriorityBorderColor, rgba } from '../../utils/kanban-colors';
import type { Task } from '../../../shared/types';
import type { ColumnColorTheme } from '../../utils/kanban-colors';

interface KanbanCardProps {
  task: Task;
  onClick?: (event: React.MouseEvent) => void;
  isSelected?: boolean;
  columnColor?: ColumnColorTheme;
}

export const KanbanCard = React.memo(function KanbanCard({ task, onClick, isSelected, columnColor }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: {
      type: 'task',
      task,
    },
  });

  const borderColor = getPriorityBorderColor(task.priority);
  const accentHex = columnColor?.accentColor ?? '#6366f1';

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    opacity: isDragging ? 0.5 : 1,
    borderLeftWidth: '3px',
    borderLeftColor: borderColor,
    backgroundColor: rgba(accentHex, 0.02),
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick(e);
    }
  };

  const hasTags = task.tags && task.tags.length > 0;
  const isReview = task.status.endsWith('_review');
  const hasDescription = task.description && task.description.length > 0;
  const hasBottomRow = hasTags || task.assignee || isReview;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`p-2.5 transition-all duration-200 hover:translate-y-[-2px] hover:shadow-md ${isDragging ? 'cursor-grabbing shadow-lg' : 'cursor-grab'} ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''} [&[data-kanban-selected=true]]:ring-2 [&[data-kanban-selected=true]]:ring-primary`}
      data-task-id={task.id}
      onClick={handleClick}
      {...listeners}
      {...attributes}
    >
      <div className="min-w-0">
        {/* Title */}
        <span
          className="font-semibold text-sm leading-snug block"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {task.title}
        </span>

        {/* Description preview */}
        {hasDescription && (
          <p
            className="text-xs text-muted-foreground mt-1 leading-snug"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {task.description}
          </p>
        )}

        {/* Tags / Assignee / Review row */}
        {hasBottomRow && (
          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
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
                  className="inline-flex items-center text-[11px] font-medium px-1.5 py-0 rounded-full border leading-relaxed"
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
                  width: '18px',
                  height: '18px',
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
    </Card>
  );
});
