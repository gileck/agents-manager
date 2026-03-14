import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { formatRelativeTimestamp } from '../tasks/task-helpers';
import { SidebarSection } from './SidebarSection';
import { reportError } from '../../lib/error-handler';
import type { Task } from '../../../shared/types';

const RECENT_TASKS_LIMIT = 15;

function sortAndSlice(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT_TASKS_LIMIT);
}

export function SidebarRecentTasks() {
  const { currentProjectId } = useCurrentProject();
  const [tasks, setTasks] = useState<Task[]>([]);
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

  if (!currentProjectId) {
    return (
      <SidebarSection title="Recent Tasks" storageKey="recentTasks">
        <p className="px-3 py-2 text-xs text-muted-foreground">No project selected</p>
      </SidebarSection>
    );
  }

  return (
    <SidebarSection title="Recent Tasks" storageKey="recentTasks">
      {tasks.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No recent tasks</p>
      ) : (
        <div className="px-1">
          {tasks.map((task) => {
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
