import { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentRun } from '../../shared/types';

export interface ActiveAgentEntry {
  run: AgentRun;
  taskTitle: string;
}

export function useActiveAgentRuns() {
  const [activeRuns, setActiveRuns] = useState<AgentRun[]>([]);
  const [completedRuns, setCompletedRuns] = useState<Map<string, AgentRun>>(new Map());
  const [error, setError] = useState<string | null>(null);
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
    } catch (err) {
      console.debug('useActiveAgentRuns: fetchTaskTitle failed:', err);
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
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
          } catch (err) {
            console.debug('useActiveAgentRuns: fetching finished run failed:', err);
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
    } catch (err) {
      setError(String(err));
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

  // Sort entries: running agents first, then by completedAt (most recent first)
  entries.sort((a, b) => {
    // Running agents always come first
    if (a.run.status === 'running' && b.run.status !== 'running') return -1;
    if (a.run.status !== 'running' && b.run.status === 'running') return 1;

    // Both running or both not running
    if (a.run.status === 'running' && b.run.status === 'running') {
      // For running agents, sort by startedAt (most recent first)
      return b.run.startedAt - a.run.startedAt;
    }

    // For non-running agents, sort by completedAt if available
    const aCompleted = a.run.completedAt || 0;
    const bCompleted = b.run.completedAt || 0;
    return bCompleted - aCompleted;
  });

  return { entries, refresh, error };
}
