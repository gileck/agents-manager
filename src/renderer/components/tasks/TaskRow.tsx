import React from 'react';
import { Badge } from '../ui/badge';
import type { BadgeProps } from '../ui/badge';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import { GitPullRequest } from 'lucide-react';
import { TaskItemMenu } from './TaskItemMenu';
import { TaskListRow } from './TaskListRow';
import { TaskTypeIcon } from './TaskTypeIcon';
import { formatRelativeTimestamp } from './task-helpers';
import type { ViewMode } from './task-helpers';
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
  viewMode?: ViewMode;
  hideStatus?: boolean;
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
  viewMode = 'card',
  hideStatus = false,
}: TaskRowProps) {
  if (viewMode === 'list') {
    return (
      <TaskListRow
        task={task}
        pipeline={pipeline}
        hasActiveAgent={hasActiveAgent}
        featureName={featureName}
        selectMode={selectMode}
        selected={selected}
        onToggleSelect={onToggleSelect}
        onClick={onClick}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onStatusChange={onStatusChange}
        hideStatus={hideStatus}
      />
    );
  }

  // Card mode — plain border-rounded div, no description to reduce clutter
  return (
    <div
      className={`group cursor-pointer border rounded-lg bg-card px-3 py-2.5 hover:bg-accent/50 transition-colors ${selected ? 'ring-2 ring-primary' : ''} ${hasActiveAgent ? 'border-l-2 border-l-green-500' : ''}`}
      onClick={onClick}
    >
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
        {!hideStatus && <PipelineBadge status={task.status} pipeline={pipeline} />}
        <Badge variant={PRIORITY_VARIANTS[task.priority] ?? 'outline'}>P{task.priority}</Badge>
        <TaskTypeIcon type={task.type} size={16} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{task.title}</span>
            {featureName && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                {featureName}
              </Badge>
            )}
            {task.createdBy && task.createdBy !== 'user' && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 text-purple-500 border-purple-500/40">
                {task.createdBy === 'workflow-reviewer' ? 'workflow' : 'agent'}
              </Badge>
            )}
            {task.status === 'needs_info' && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 shrink-0 text-amber-600 border-amber-500/40 bg-amber-500/10"
                onClick={(e) => e.stopPropagation()}
              >
                ⚠ Needs Input
              </Badge>
            )}
          </div>
          {task.tags.length > 0 && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {task.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {task.subtasks.length > 0 && (
            <span className="text-xs text-muted-foreground font-medium" title="Subtask progress">
              {task.subtasks.filter((s) => s.status === 'done').length}/{task.subtasks.length}
            </span>
          )}
          {task.prLink && (
            <button
              onClick={(e) => { e.stopPropagation(); window.api.shell.openInChrome(task.prLink!); }}
              title="Open PR in Chrome"
              className="cursor-pointer hover:text-blue-500 transition-colors"
            >
              <GitPullRequest className="h-4 w-4" />
            </button>
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
    </div>
  );
}
