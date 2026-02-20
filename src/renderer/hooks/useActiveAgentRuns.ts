import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentRun } from '../../shared/types';

export interface ActiveAgentEntry {
  run: AgentRun;
  taskTitle: string;
}

export function useActiveAgentRuns() {
  const [activeRuns, setActiveRuns] = useState<AgentRun[]>([]);
  const [completedRuns, setCompletedRuns] = useState<Map<string, AgentRun>>(new Map());
  const completedRunsRef = useRef(completedRuns);
  completedRunsRef.current = completedRuns;
  const taskTitleCache = useRef<Map<string, string>>(new Map());
  const [taskTitles, setTaskTitles] = useState<Map<string, string>>(new Map());
  const previousRunIds = useRef<Set<string>>(new Set());

  const fetchTaskTitle = useCallback(async (taskId: string) => {
    if (taskTitleCache.current.has(taskId)) return;
    try {
      const task = await window.api.tasks.get(taskId);
      if (task) {
        taskTitleCache.current.set(taskId, task.title);
        setTaskTitles(new Map(taskTitleCache.current));
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const runs = await window.api.agents.activeRuns();
      const currentIds = new Set(runs.map((r) => r.id));

      // Detect runs that disappeared (completed/failed)
      for (const prevId of previousRunIds.current) {
        if (!currentIds.has(prevId) && !completedRunsRef.current.has(prevId)) {
          try {
            const finishedRun = await window.api.agents.get(prevId);
            if (finishedRun) {
              setCompletedRuns((prev) => new Map(prev).set(prevId, finishedRun));
            }
          } catch {
            // ignore
          }
        }
      }

      previousRunIds.current = currentIds;
      setActiveRuns(runs);

      // Fetch task titles for any new task IDs
      const taskIds = new Set(runs.map((r) => r.taskId));
      for (const taskId of taskIds) {
        fetchTaskTitle(taskId);
      }
    } catch {
      // ignore
    }
  }, [fetchTaskTitle]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const refresh = useCallback(() => {
    setCompletedRuns(new Map());
    taskTitleCache.current.clear();
    setTaskTitles(new Map());
    fetchData();
  }, [fetchData]);

  // Merge active + completed
  const entries: ActiveAgentEntry[] = [];
  for (const run of activeRuns) {
    entries.push({ run, taskTitle: taskTitles.get(run.taskId) || 'Loading...' });
  }
  for (const [, run] of completedRuns) {
    entries.push({ run, taskTitle: taskTitles.get(run.taskId) || 'Loading...' });
  }

  return { entries, refresh };
}
