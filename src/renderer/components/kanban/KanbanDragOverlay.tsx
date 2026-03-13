import React from 'react';
import { DragOverlay } from '@dnd-kit/core';
import { Card } from '../ui/card';
import { getTagColor, getPriorityBorderColor } from '../../utils/kanban-colors';
import type { Task } from '../../../shared/types';

interface KanbanDragOverlayProps {
  activeTask: Task | null;
}

export function KanbanDragOverlay({ activeTask }: KanbanDragOverlayProps) {
  return (
    <DragOverlay>
      {activeTask ? (
        <Card
          className="p-2.5 shadow-2xl cursor-grabbing"
          style={{
            borderLeftWidth: '3px',
            borderLeftColor: getPriorityBorderColor(activeTask.priority),
            transform: 'rotate(2deg) scale(1.05)',
            opacity: 0.95,
          }}
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
              {activeTask.title}
            </span>

            {/* Description preview */}
            {activeTask.description && (
              <p
                className="text-xs text-muted-foreground mt-1 leading-snug"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 1,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {activeTask.description}
              </p>
            )}

            {/* Tags & assignee */}
            {(activeTask.tags?.length > 0 || activeTask.assignee) && (
              <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                {activeTask.tags?.map((tag) => {
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
                {activeTask.assignee && (
                  <div
                    className="shrink-0 flex items-center justify-center text-[8px] font-bold uppercase ml-auto"
                    style={{ width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'hsl(var(--primary))', color: '#fff' }}
                  >
                    {activeTask.assignee.charAt(0)}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      ) : null}
    </DragOverlay>
  );
}
