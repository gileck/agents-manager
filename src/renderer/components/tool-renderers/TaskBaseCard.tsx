import React from 'react';
import { Badge } from '../ui/badge';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import type { Task } from '../../../shared/types';

const PRIORITY_LABELS: Record<number, string> = {
  0: 'P0',
  1: 'P1',
  2: 'P2',
  3: 'P3',
};

interface TaskBaseCardProps {
  task: Task;
  children?: React.ReactNode;
}

export function TaskBaseCard({ task, children }: TaskBaseCardProps) {
  const priorityLabel = PRIORITY_LABELS[task.priority] ?? `P${task.priority}`;

  return (
    <div className="border border-border rounded p-3 my-1 bg-card space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <PipelineBadge status={task.status} />
        <Badge variant="outline">{priorityLabel}</Badge>
        <Badge variant="secondary">{task.type}</Badge>
      </div>

      <div className="font-medium text-sm leading-snug">{task.title}</div>

      {task.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {task.description}
        </p>
      )}

      {children}
    </div>
  );
}
