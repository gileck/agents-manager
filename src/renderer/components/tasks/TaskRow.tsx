import React from 'react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import { Copy, Trash2, GitPullRequest } from 'lucide-react';
import { PRIORITY_LABELS, formatRelativeTimestamp } from './task-helpers';
import type { Task, Pipeline } from '../../../shared/types';

const PRIORITY_BORDER_COLORS: Record<number, string> = {
  0: 'border-l-red-500',
  1: 'border-l-orange-400',
  2: 'border-l-yellow-400',
  3: 'border-l-green-400',
};

function getStatusBgColor(status: string, pipeline: Pipeline | null): string {
  if (!pipeline) return '';
  const statusDef = pipeline.statuses.find((s) => s.name === status);
  if (!statusDef?.color) return '';

  const color = statusDef.color;
  // Map named colors to subtle Tailwind bg tints
  const namedColorMap: Record<string, string> = {
    blue: 'bg-blue-500/5',
    gray: 'bg-gray-500/5',
    red: 'bg-red-500/5',
    green: 'bg-green-500/5',
    yellow: 'bg-yellow-500/5',
    orange: 'bg-orange-500/5',
  };
  if (namedColorMap[color]) return namedColorMap[color];

  // For hex colors, use inline style instead (handled in component)
  return '';
}

function getStatusHexBg(status: string, pipeline: Pipeline | null): string | undefined {
  if (!pipeline) return undefined;
  const statusDef = pipeline.statuses.find((s) => s.name === status);
  if (!statusDef?.color || !statusDef.color.startsWith('#')) return undefined;
  return `${statusDef.color}0D`; // ~5% opacity (hex 0D = 13/255)
}

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
  const priorityBorder = PRIORITY_BORDER_COLORS[task.priority] ?? 'border-l-gray-300';
  const statusBg = getStatusBgColor(task.status, pipeline);
  const statusHexBg = getStatusHexBg(task.status, pipeline);

  return (
    <Card
      className={`cursor-pointer hover:bg-accent/50 transition-colors border-l-[3px] ${priorityBorder} ${statusBg} ${selected ? 'ring-2 ring-primary' : ''} ${hasActiveAgent ? 'ring-1 ring-green-500' : ''}`}
      style={statusHexBg ? { backgroundColor: statusHexBg } : undefined}
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
