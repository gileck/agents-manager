import React from 'react';
import { DragOverlay } from '@dnd-kit/core';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { GripVertical } from 'lucide-react';
import type { Task } from '../../../shared/types';

interface KanbanDragOverlayProps {
  activeTask: Task | null;
}

export function KanbanDragOverlay({ activeTask }: KanbanDragOverlayProps) {
  return (
    <DragOverlay>
      {activeTask ? (
        <Card className="p-3 shadow-xl opacity-90 cursor-grabbing">
          <div className="flex gap-2">
            <div className="flex items-start pt-0.5">
              <GripVertical className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="font-medium text-sm">{activeTask.title}</div>
              {activeTask.description && (
                <div className="text-xs text-muted-foreground line-clamp-2">
                  {activeTask.description}
                </div>
              )}
              {activeTask.tags && activeTask.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {activeTask.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
              {activeTask.assignee && (
                <div className="text-xs text-muted-foreground">
                  Assignee: {activeTask.assignee}
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : null}
    </DragOverlay>
  );
}
