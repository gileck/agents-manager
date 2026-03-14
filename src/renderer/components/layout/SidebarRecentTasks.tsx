import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { formatRelativeTimestamp } from '../tasks/task-helpers';
import { SidebarSection } from './SidebarSection';
import { reportError } from '../../lib/error-handler';
import type { Task } from '../../../shared/types';
import { RunningIndicator } from './ActiveAgentsList';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';

const RECENT_TASKS_LIMIT = 15;
const STORAGE_KEY = 'sidebar.recentTasks.hiddenStatuses';

const STATUS_ICONS: Record<string, React.ReactNode> = {
  done: (
    <svg className="shrink-0 w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="#22c55e" />
      <path d="M4.5 8.5L7 11L11.5 5.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  open: (
    <svg className="shrink-0 w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="#3b82f6" />
      <circle cx="8" cy="8" r="3" fill="white" />
    </svg>
  ),
  closed: (
    <svg className="shrink-0 w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="#6b7280" />
    </svg>
  ),
  _default: (
    <svg className="shrink-0 w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#22c55e" strokeWidth="2" fill="white" />
    </svg>
  ),
};

function sortAndSlice(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_TASKS_LIMIT);
}

function readHiddenStatusesFromStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set<string>(parsed);
    }
  } catch {
    // ignore malformed data
  }
  return new Set<string>();
}

interface SidebarRecentTasksProps {
  runningTaskIds: Set<string>;
}

export function SidebarRecentTasks({ runningTaskIds }: SidebarRecentTasksProps) {
  const { currentProjectId } = useCurrentProject();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(readHiddenStatusesFromStorage);
  const navigate = useNavigate();
  const location = useLocation();

  // Initial fetch on project change
  useEffect(() => {
    if (!currentProjectId) {
      setTasks([]);
      return;
    }
    window.api.tasks
      .list({ projectId: currentProjectId })
      .then((result) => setTasks(sortAndSlice(result)))
      .catch((err) => reportError(err, 'Load recent tasks'));
  }, [currentProjectId]);

  // Live updates via WebSocket
  useEffect(() => {
    const unsubscribe = window.api.on.taskStatusChanged((_taskId, task) => {
      if (task.projectId !== currentProjectId) return;
      setTasks((prev) => {
        const without = prev.filter((t) => t.id !== task.id);
        return sortAndSlice([task, ...without]);
      });
    });
    return unsubscribe;
  }, [currentProjectId]);

  // Collect unique statuses from the full task pool
  const allStatuses = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.status))).sort(),
    [tasks]
  );

  // Tasks visible after applying the filter
  const visibleTasks = useMemo(
    () => tasks.filter((t) => !hiddenStatuses.has(t.status)),
    [tasks, hiddenStatuses]
  );

  const isFiltered = hiddenStatuses.size > 0;

  const toggleStatus = (status: string) => {
    setHiddenStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const resetFilter = () => {
    setHiddenStatuses(new Set());
    localStorage.removeItem(STORAGE_KEY);
  };

  // Filter icon button rendered in the SidebarSection header
  const filterButton = (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative flex items-center justify-center w-5 h-5 rounded transition-colors',
            isFiltered
              ? 'text-primary hover:text-primary/80'
              : 'text-muted-foreground hover:text-foreground'
          )}
          title="Filter by status"
        >
          <SlidersHorizontal className="w-3 h-3" />
          {isFiltered && (
            <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="p-2 w-44">
        <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Filter by status
        </p>
        {allStatuses.length === 0 ? (
          <p className="px-1 py-1 text-xs text-muted-foreground">No statuses</p>
        ) : (
          <ul className="space-y-0.5">
            {allStatuses.map((status) => {
              const checked = !hiddenStatuses.has(status);
              return (
                <li key={status}>
                  <label className="flex items-center gap-2 px-1 py-1 rounded cursor-pointer hover:bg-accent/50 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStatus(status)}
                      className="accent-primary w-3 h-3 shrink-0"
                    />
                    {STATUS_ICONS[status] ?? STATUS_ICONS._default}
                    <span className="truncate capitalize">{status}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {isFiltered && (
          <button
            type="button"
            onClick={resetFilter}
            className="mt-1.5 w-full text-center text-[10px] text-primary hover:underline"
          >
            Show all
          </button>
        )}
      </PopoverContent>
    </Popover>
  );

  if (!currentProjectId) {
    return (
      <SidebarSection title="Recent Tasks" storageKey="recentTasks">
        <p className="px-3 py-2 text-xs text-muted-foreground">No project selected</p>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection title="Recent Tasks" storageKey="recentTasks" trailing={filterButton}>
      {visibleTasks.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {tasks.length === 0 ? 'No recent tasks' : 'No tasks match the current filter'}
        </p>
      ) : (
        <div className="px-1">
          {visibleTasks.map((task) => {
            const isActive = location.pathname === `/tasks/${task.id}`;
            return (
              <div
                key={task.id}
                onClick={() => navigate(`/tasks/${task.id}`)}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer transition-colors mb-1 border border-transparent',
                  isActive
                    ? 'bg-accent/80 text-foreground border-border/55'
                    : 'text-muted-foreground hover:bg-accent/55 hover:text-foreground'
                )}
              >
                {runningTaskIds.has(task.id) ? <RunningIndicator /> : (STATUS_ICONS[task.status] ?? STATUS_ICONS._default)}
                <span className="flex-1 min-w-0 truncate font-medium">{task.title}</span>
                <span
                  className={cn(
                    'text-[10px] shrink-0',
                    isActive ? 'text-foreground/60' : 'text-muted-foreground'
                  )}
                >
                  {formatRelativeTimestamp(task.updatedAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </SidebarSection>
  );
}
