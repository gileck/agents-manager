import React from 'react';
import { DragOverlay } from '@dnd-kit/core';
import { Card } from '../ui/card';
import { GripVertical } from 'lucide-react';
import { getTagColor } from '../../utils/kanban-colors';
import type { Task } from '../../../shared/types';

interface KanbanDragOverlayProps {
  activeTask: Task | null;
}

export function KanbanDragOverlay({ activeTask }: KanbanDragOverlayProps) {
  return (
    <DragOverlay>
      {activeTask ? (
        <Card
          className="p-3 shadow-2xl cursor-grabbing"
          style={{ borderLeftWidth: '3px', borderLeftColor: 'hsl(var(--primary))', transform: 'rotate(2deg) scale(1.05)', opacity: 0.95 }}
        >
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
                  {activeTask.tags.map((tag) => {
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
              {activeTask.assignee && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div
                    className="flex items-center justify-center text-[9px] font-bold uppercase"
                    style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'hsl(var(--primary))', color: '#fff' }}
                  >
                    {activeTask.assignee.charAt(0)}
                  </div>
                  {activeTask.assignee}
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : null}
    </DragOverlay>
  );
}
