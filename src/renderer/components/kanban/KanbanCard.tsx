import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import type { Task } from '../../../shared/types';

interface KanbanCardProps {
  task: Task;
  onClick?: (event: React.MouseEvent) => void;
  isSelected?: boolean;
}

export const KanbanCard = React.memo(function KanbanCard({ task, onClick, isSelected }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: {
      type: 'task',
      task,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : 1,
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
      className={`p-3 transition-all ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} ${isSelected ? 'ring-2 ring-primary bg-primary/5' : ''} [&[data-kanban-selected=true]]:ring-2 [&[data-kanban-selected=true]]:ring-primary`}
      data-task-id={task.id}
    >
      <div className="flex gap-2">
        <div
          {...listeners}
          {...attributes}
          className="flex items-start pt-0.5 cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 space-y-2 cursor-pointer" onClick={handleClick}>
          <div className="font-medium text-sm">{task.title}</div>
          {task.description && (
            <div className="text-xs text-muted-foreground line-clamp-2">
              {task.description}
            </div>
          )}
          {task.tags && task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
          {task.assignee && (
            <div className="text-xs text-muted-foreground">
              Assignee: {task.assignee}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
});
