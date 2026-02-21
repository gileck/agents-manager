import React from 'react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import type { Task } from '../../../shared/types';

interface KanbanCardProps {
  task: Task;
  onClick?: () => void;
}

export function KanbanCard({ task, onClick }: KanbanCardProps) {
  return (
    <Card
      className="p-3 cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      <div className="space-y-2">
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
    </Card>
  );
}
