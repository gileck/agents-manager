import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, ListTodo } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Task } from '../../../shared/types';
import { useTrackedTasks } from '../../hooks/useTrackedTasks';

interface TaskStatusBarProps {
  sessionId: string | null;
}

function getStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('done') || s.includes('complet') || s.includes('merged') || s.includes('closed')) {
    return 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30';
  }
  if (s.includes('fail') || s.includes('cancel') || s.includes('block') || s.includes('reject')) {
    return 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30';
  }
  if (s.includes('implement') || s.includes('develop') || s.includes('in_progress') || s.includes('progress')) {
    return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30';
  }
  if (s.includes('review') || s.includes('approv') || s.includes('human')) {
    return 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30';
  }
  if (s.includes('plan') || s.includes('design') || s.includes('triage') || s.includes('analyz')) {
    return 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30';
  }
  // default: open / backlog / unknown
  return 'bg-muted/60 text-muted-foreground border-border/50';
}

function buildSummary(tasks: Task[]): string {
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([status, count]) => `${count} ${status}`);
  return `${tasks.length} task${tasks.length === 1 ? '' : 's'} · ${parts.join(' · ')}`;
}

export function TaskStatusBar({ sessionId }: TaskStatusBarProps) {
  const { tasks } = useTrackedTasks(sessionId);
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  const summary = useMemo(() => buildSummary(tasks), [tasks]);

  if (tasks.length === 0) return null;

  return (
    <div className="border-t border-border/60 bg-card/30 backdrop-blur-sm">
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors text-left"
      >
        <ListTodo className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate">{summary}</span>
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          : <ChevronUp className="h-3.5 w-3.5 shrink-0" />}
      </button>

      {/* Expanded task list */}
      {expanded && (
        <div className="border-t border-border/40 max-h-52 overflow-y-auto">
          {tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => navigate(`/tasks/${task.id}`)}
              className="w-full flex items-center gap-3 px-4 py-2 text-xs hover:bg-accent/40 transition-colors text-left group"
            >
              <span
                className={`shrink-0 px-1.5 py-0.5 rounded border text-[10px] font-medium leading-tight ${getStatusColor(task.status)}`}
              >
                {task.status}
              </span>
              <span className="flex-1 truncate text-foreground group-hover:text-foreground/90">
                {task.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
