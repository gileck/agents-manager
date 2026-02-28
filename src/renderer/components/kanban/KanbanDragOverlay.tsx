import React from 'react';
import { DragOverlay } from '@dnd-kit/core';
import { Card } from '../ui/card';
import { GripVertical } from 'lucide-react';
import { getTagColor } from '../../utils/kanban-colors';
import type { Task } from '../../../shared/types';

interface KanbanDragOverlayProps {
  activeTask: Task | null;
}

const PRIORITY_COLORS: Record<number, string> = {
  0: '#ef4444',
  1: '#f59e0b',
};

export function KanbanDragOverlay({ activeTask }: KanbanDragOverlayProps) {
  return (
    <DragOverlay>
      {activeTask ? (
        <Card
          className="p-2 shadow-2xl cursor-grabbing"
          style={{ borderLeftWidth: '3px', borderLeftColor: 'hsl(var(--primary))', transform: 'rotate(2deg) scale(1.05)', opacity: 0.95 }}
        >
          <div className="flex gap-1.5">
            <div className="flex items-start pt-0.5">
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-1">
                {PRIORITY_COLORS[activeTask.priority] && (
                  <span
                    className="shrink-0 mt-1 rounded-full"
                    style={{ width: '6px', height: '6px', backgroundColor: PRIORITY_COLORS[activeTask.priority] }}
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
                  {activeTask.title}
                </span>
              </div>
              {(activeTask.tags?.length > 0 || activeTask.assignee) && (
                <div className="flex items-center gap-1 mt-1">
                  {activeTask.tags?.map((tag) => {
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
                  {activeTask.assignee && (
                    <div
                      className="shrink-0 flex items-center justify-center text-[8px] font-bold uppercase ml-auto"
                      style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: 'hsl(var(--primary))', color: '#fff' }}
                    >
                      {activeTask.assignee.charAt(0)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : null}
    </DragOverlay>
  );
}
