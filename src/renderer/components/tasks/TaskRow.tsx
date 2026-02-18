import React from 'react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import { Copy, Trash2, GitPullRequest } from 'lucide-react';
import { PRIORITY_LABELS, formatRelativeTimestamp } from './task-helpers';
import type { Task, Pipeline } from '../../../shared/types';

interface TaskRowProps {
  task: Task;
  pipeline: Pipeline | null;
  hasActiveAgent: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

export function TaskRow({
  task,
  pipeline,
  hasActiveAgent,
  selectMode,
  selected,
  onToggleSelect,
  onClick,
  onDelete,
  onDuplicate,
}: TaskRowProps) {
  return (
    <Card
      className={`cursor-pointer hover:bg-accent/50 transition-colors ${selected ? 'ring-2 ring-primary' : ''} ${hasActiveAgent ? 'border-l-2 border-l-green-500' : ''}`}
      onClick={onClick}
    >
      <CardContent className="py-3">
        <div className="flex items-center gap-3">
          {selectMode && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              onClick={(e) => e.stopPropagation()}
              className="h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer"
            />
          )}
          <PipelineBadge status={task.status} pipeline={pipeline} />
          <Badge variant="outline">P{task.priority}</Badge>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{task.title}</span>
              {task.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
              {task.tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground">+{task.tags.length - 3}</span>
              )}
            </div>
            {task.description && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {task.description}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {task.prLink && (
              <GitPullRequest className="h-4 w-4 text-muted-foreground" />
            )}
            {task.assignee && (
              <span className="text-sm text-muted-foreground">@{task.assignee}</span>
            )}
            <span className="text-xs text-muted-foreground w-16 text-right">
              {formatRelativeTimestamp(task.updatedAt)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
              title="Duplicate"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
