import React from 'react';
import { Badge } from '../ui/badge';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import type { ToolRendererProps } from './types';

interface CompactTask {
  id: string;
  title: string;
  status: string;
  priority?: number;
  type?: string;
}

const PRIORITY_LABELS: Record<number, string> = {
  0: 'P0',
  1: 'P1',
  2: 'P2',
  3: 'P3',
};

function parseTaskList(result: string): CompactTask[] | null {
  try {
    const parsed = JSON.parse(result);
    if (!Array.isArray(parsed)) return null;
    return parsed as CompactTask[];
  } catch {
    return null;
  }
}

export function TaskListCard({ toolResult }: ToolRendererProps) {
  if (!toolResult) {
    return (
      <div className="border border-border rounded p-3 my-1 bg-card text-xs text-muted-foreground">
        Loading tasks…
      </div>
    );
  }

  const tasks = parseTaskList(toolResult.result);

  if (!tasks) {
    return (
      <div className="border border-destructive/40 rounded p-3 my-1 bg-card text-xs text-destructive">
        Failed to load tasks
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="border border-border rounded p-3 my-1 bg-card text-xs text-muted-foreground">
        No tasks found
      </div>
    );
  }

  return (
    <div className="border border-border rounded my-1 bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border/60 bg-muted/30">
        <span className="text-xs font-medium text-foreground">
          Tasks ({tasks.length})
        </span>
      </div>
      <ul className="divide-y divide-border/40 max-h-72 overflow-y-auto">
        {tasks.map((task) => {
          const priorityLabel = task.priority !== undefined
            ? (PRIORITY_LABELS[task.priority] ?? `P${task.priority}`)
            : null;
          return (
            <li key={task.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors">
              <PipelineBadge status={task.status} />
              <span className="flex-1 min-w-0 text-xs text-foreground truncate">
                {task.title}
              </span>
              {priorityLabel && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                  {priorityLabel}
                </Badge>
              )}
              {task.type && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                  {task.type}
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
