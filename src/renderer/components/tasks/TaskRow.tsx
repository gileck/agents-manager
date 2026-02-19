import React from 'react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import type { BadgeProps } from '../ui/badge';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import { GitPullRequest } from 'lucide-react';
import { TaskItemMenu } from './TaskItemMenu';
import { formatRelativeTimestamp } from './task-helpers';
import type { Task, Pipeline } from '../../../shared/types';

const PRIORITY_VARIANTS: Record<number, NonNullable<BadgeProps['variant']>> = {
  0: 'destructive',
  1: 'warning',
  2: 'default',
  3: 'success',
};

interface TaskRowProps {
  task: Task;
  pipeline: Pipeline | null;
  hasActiveAgent: boolean;
  featureName?: string;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onStatusChange: (taskId: string, toStatus: string) => Promise<void>;
}

export function TaskRow({
  task,
  pipeline,
  hasActiveAgent,
  featureName,
  selectMode,
  selected,
  onToggleSelect,
  onClick,
  onDelete,
  onDuplicate,
  onStatusChange,
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
          <Badge variant={PRIORITY_VARIANTS[task.priority] ?? 'outline'}>P{task.priority}</Badge>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{task.title}</span>
              {featureName && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                  {featureName}
                </Badge>
              )}
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
            {task.subtasks.length > 0 && (
              <span className="text-xs text-muted-foreground font-medium" title="Subtask progress">
                {task.subtasks.filter((s) => s.status === 'done').length}/{task.subtasks.length}
              </span>
            )}
            {task.prLink && (
              <GitPullRequest className="h-4 w-4 text-muted-foreground" />
            )}
            {task.assignee && (
              <span className="text-sm text-muted-foreground">@{task.assignee}</span>
            )}
            <span className="text-xs text-muted-foreground w-16 text-right">
              {formatRelativeTimestamp(task.updatedAt)}
            </span>
            <TaskItemMenu
              task={task}
              pipeline={pipeline}
              onStatusChange={onStatusChange}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
