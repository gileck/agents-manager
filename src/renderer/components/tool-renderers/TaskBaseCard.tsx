import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../ui/badge';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import { MarkdownContent } from '../chat/MarkdownContent';
import type { Task } from '../../../shared/types';

const PRIORITY_LABELS: Record<number, string> = {
  0: 'P0',
  1: 'P1',
  2: 'P2',
  3: 'P3',
};

const DESCRIPTION_PREVIEW_LEN = 120;

interface TaskBaseCardProps {
  task: Task;
  children?: React.ReactNode;
}

export function TaskBaseCard({ task, children }: TaskBaseCardProps) {
  const navigate = useNavigate();
  const [descExpanded, setDescExpanded] = useState(false);
  const priorityLabel = PRIORITY_LABELS[task.priority] ?? `P${task.priority}`;
  const hasLongDescription = task.description != null && task.description.length > DESCRIPTION_PREVIEW_LEN;

  return (
    <div className="border border-border rounded p-3 my-1 bg-card space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <PipelineBadge status={task.status} />
        <Badge variant="outline">{priorityLabel}</Badge>
        <Badge variant="secondary">{task.type}</Badge>
        <button
          className="ml-auto text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          onClick={() => navigate(`/tasks/${task.id}`)}
        >
          Open ↗
        </button>
      </div>

      <div className="font-medium text-sm leading-snug">{task.title}</div>

      {task.description && (
        <div className="space-y-1">
          {descExpanded ? (
            <div className="text-xs prose-sm max-h-64 overflow-y-auto">
              <MarkdownContent content={task.description} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {task.description}
            </p>
          )}
          {hasLongDescription && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              onClick={() => setDescExpanded((v) => !v)}
            >
              {descExpanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}

      {children}
    </div>
  );
}
