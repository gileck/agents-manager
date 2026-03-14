import React from 'react';
import { Badge } from '../ui/badge';
import { GitPullRequest } from 'lucide-react';
import { TaskItemMenu } from './TaskItemMenu';
import { formatRelativeTimestamp } from './task-helpers';
import type { Task, Pipeline } from '../../../shared/types';

// Priority → left-border accent color
const PRIORITY_BORDER_CLASS: Record<number, string> = {
  0: 'border-l-red-500',
  1: 'border-l-orange-500',
  2: 'border-l-blue-500',
  3: 'border-l-green-500',
};

// Named pipeline status colors → CSS color strings
const NAMED_COLOR_CSS: Record<string, string> = {
  blue: '#3b82f6',
  gray: '#6b7280',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
};

function getStatusDotColor(status: string, pipeline: Pipeline | null): string | undefined {
  if (!pipeline) return undefined;
  const statusDef = pipeline.statuses.find((s) => s.name === status);
  if (!statusDef?.color) return undefined;
  const color = statusDef.color;
  if (color.startsWith('#')) return color;
  return NAMED_COLOR_CSS[color];
}

interface TaskListRowProps {
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
  hideStatus?: boolean;
}

export function TaskListRow({
  task,
  pipeline,
  hasActiveAgent,
  selectMode,
  selected,
  onToggleSelect,
  onClick,
  onDelete,
  onDuplicate,
  onStatusChange,
  hideStatus = false,
}: TaskListRowProps) {
  const priorityBorderClass = PRIORITY_BORDER_CLASS[task.priority] ?? 'border-l-border';
  // Active agent overrides the priority left-border
  const borderClass = hasActiveAgent ? 'border-l-green-500' : priorityBorderClass;
  const statusDotColor = getStatusDotColor(task.status, pipeline);

  const doneSubtasks = task.subtasks.filter((s) => s.status === 'done').length;

  return (
    <div
      className={`group flex items-center gap-2 px-3 h-9 cursor-pointer hover:bg-accent/50 transition-colors border-l-[3px] ${borderClass} ${selected ? 'bg-primary/5' : ''}`}
      onClick={onClick}
    >
      {/* Checkbox — hidden until hover (always visible in selectMode) */}
      <div className="w-5 shrink-0 flex items-center justify-center">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
          className={`h-4 w-4 rounded border-gray-300 accent-primary cursor-pointer transition-opacity ${
            selectMode ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />
      </div>

      {/* Status dot */}
      {!hideStatus && (
        <span
          className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/40"
          style={statusDotColor ? { backgroundColor: statusDotColor } : undefined}
          title={task.status}
        />
      )}

      {/* Title */}
      <span className="flex-1 min-w-0 font-medium text-sm truncate">
        {task.title}
      </span>

      {/* Tags: max 2 + overflow count */}
      <div className="hidden sm:flex items-center gap-1 shrink-0">
        {task.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {tag}
          </Badge>
        ))}
        {task.tags.length > 2 && (
          <span className="text-[10px] text-muted-foreground">+{task.tags.length - 2}</span>
        )}
      </div>

      {/* Meta section */}
      <div className="flex items-center gap-3 shrink-0">
        {task.subtasks.length > 0 && (
          <span className="text-xs text-muted-foreground font-medium" title="Subtask progress">
            {doneSubtasks}/{task.subtasks.length}
          </span>
        )}
        {task.prLink && (
          <button
            onClick={(e) => { e.stopPropagation(); window.api.shell.openInChrome(task.prLink!); }}
            title="Open PR in Chrome"
            className="cursor-pointer hover:text-blue-500 transition-colors opacity-0 group-hover:opacity-100"
          >
            <GitPullRequest className="h-3.5 w-3.5" />
          </button>
        )}
        {task.assignee && (
          <span className="hidden md:block text-xs text-muted-foreground w-20 truncate">
            @{task.assignee}
          </span>
        )}
        <span className="text-xs text-muted-foreground w-14 text-right">
          {formatRelativeTimestamp(task.updatedAt)}
        </span>
      </div>

      {/* Context menu — hover-revealed */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <TaskItemMenu
          task={task}
          pipeline={pipeline}
          onStatusChange={onStatusChange}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
