import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Card } from '../ui/card';
import { getTagColor } from '../../utils/kanban-colors';
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

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform) ?? undefined,
    opacity: isDragging ? 0.5 : 1,
    borderLeftWidth: '3px',
    borderLeftColor: columnColor?.accentColor ?? 'hsl(var(--primary))',
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      onClick(e);
    }
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`p-3 transition-all duration-200 hover:translate-y-[-1px] hover:shadow-md ${isDragging ? 'cursor-grabbing shadow-lg' : 'cursor-grab'} ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''} [&[data-kanban-selected=true]]:ring-2 [&[data-kanban-selected=true]]:ring-primary`}
      data-task-id={task.id}
    >
      <div className="flex gap-2">
        <div
          {...listeners}
          {...attributes}
          className="flex items-start pt-0.5 cursor-grab active:cursor-grabbing opacity-40 hover:opacity-100 transition-opacity"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 space-y-2 cursor-pointer" onClick={handleClick}>
          <div className="font-medium text-sm leading-snug">{task.title}</div>
          {task.description && (
            <div className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
              {task.description}
            </div>
          )}
          {task.tags && task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag) => {
                const tagColor = getTagColor(tag);
                return (
                  <span
                    key={tag}
                    className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border"
                    style={tagColor.style}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          )}
          {task.assignee && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <div
                className="flex items-center justify-center text-[9px] font-bold uppercase"
                style={{
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  backgroundColor: columnColor?.accentColor ?? 'hsl(var(--primary))',
                  color: '#fff',
                }}
              >
                {task.assignee.charAt(0)}
              </div>
              {task.assignee}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
});
