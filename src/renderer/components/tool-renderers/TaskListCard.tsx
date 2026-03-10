import React, { useState } from 'react';
import { Badge } from '../ui/badge';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import { useChatActions } from '../chat/ChatActionsContext';
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

interface TaskRowProps {
  task: CompactTask;
  onSelect: (task: CompactTask) => void;
  disabled: boolean;
}

function TaskRow({ task, onSelect, disabled }: TaskRowProps) {
  const priorityLabel = task.priority !== undefined
    ? (PRIORITY_LABELS[task.priority] ?? `P${task.priority}`)
    : null;
  return (
    <li
      className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={() => !disabled && onSelect(task)}
    >
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
}

interface StatusGroupProps {
  status: string;
  tasks: CompactTask[];
  onSelect: (task: CompactTask) => void;
  disabled: boolean;
}

function StatusGroup({ status, tasks, onSelect, disabled }: StatusGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div>
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-muted/20 hover:bg-muted/40 transition-colors border-b border-border/40 text-left"
        onClick={() => setCollapsed((v) => !v)}
      >
        <span className="text-[10px] text-muted-foreground">{collapsed ? '▶' : '▼'}</span>
        <PipelineBadge status={status} />
        <span className="text-[10px] text-muted-foreground ml-auto">{tasks.length}</span>
      </button>
      {!collapsed && (
        <ul className="divide-y divide-border/40">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onSelect={onSelect} disabled={disabled} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function TaskListCard({ toolResult }: ToolRendererProps) {
  const { sendMessage, isStreaming } = useChatActions();

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

  function handleSelect(task: CompactTask) {
    sendMessage(`Get details for task ${task.id}`);
  }

  // Build status counts and grouped tasks (preserving order of first occurrence)
  const statusOrder: string[] = [];
  const grouped: Record<string, CompactTask[]> = {};
  for (const task of tasks) {
    if (!grouped[task.status]) {
      statusOrder.push(task.status);
      grouped[task.status] = [];
    }
    grouped[task.status].push(task);
  }

  const multipleStatuses = statusOrder.length > 1;

  return (
    <div className="border border-border rounded my-1 bg-card overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/60 bg-muted/30 flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
          Tasks ({tasks.length})
        </span>
        {/* Status count chips */}
        {multipleStatuses && (
          <div className="flex flex-wrap gap-1">
            {statusOrder.map((status) => (
              <span
                key={status}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted/60 border border-border/50 rounded-full px-1.5 py-0.5"
              >
                <span className="font-medium">{grouped[status].length}</span>
                <span>{status}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Task list */}
      <div className="max-h-72 overflow-y-auto">
        {multipleStatuses ? (
          <div className="divide-y divide-border/40">
            {statusOrder.map((status) => (
              <StatusGroup
                key={status}
                status={status}
                tasks={grouped[status]}
                onSelect={handleSelect}
                disabled={isStreaming}
              />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border/40">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onSelect={handleSelect} disabled={isStreaming} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
