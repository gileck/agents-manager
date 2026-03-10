import { useState, useEffect } from 'react';
import type { Task, AgentChatMessage } from '../../shared/types';

function isTaskLike(obj: unknown): obj is Task {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.status === 'string' &&
    typeof o.title === 'string' &&
    typeof o.projectId === 'string'
  );
}

function extractTasksFromResult(result: string): Task[] {
  try {
    const parsed = JSON.parse(result);
    if (isTaskLike(parsed)) return [parsed];
    if (Array.isArray(parsed)) return parsed.filter(isTaskLike);
    // Some results wrap the task in a property
    if (parsed && typeof parsed === 'object') {
      const v = parsed as Record<string, unknown>;
      if (isTaskLike(v.task)) return [v.task as Task];
      if (isTaskLike(v.data)) return [v.data as Task];
    }
  } catch {
    // result is not JSON
  }
  return [];
}

export function useTrackedTasks(sessionId: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Initial fetch on mount / session change
  useEffect(() => {
    setTasks([]);
    if (!sessionId) return;

    setIsLoading(true);
    window.api.chat.trackedTasks(sessionId)
      .then(setTasks)
      .catch(() => { /* ignore fetch errors */ })
      .finally(() => setIsLoading(false));
  }, [sessionId]);

  // Subscribe to chatMessage events to pick up in-flight task objects
  useEffect(() => {
    if (!sessionId) return;

    const unsub = window.api.on.chatMessage((incomingSessionId: string, msg: AgentChatMessage) => {
      if (incomingSessionId !== sessionId) return;
      if (msg.type !== 'tool_result') return;

      const found = extractTasksFromResult(msg.result);
      if (found.length === 0) return;

      setTasks((prev) => {
        let updated = [...prev];
        for (const task of found) {
          const idx = updated.findIndex((t) => t.id === task.id);
          if (idx >= 0) {
            if (task.updatedAt > updated[idx].updatedAt) {
              updated = [...updated.slice(0, idx), task, ...updated.slice(idx + 1)];
            }
          } else {
            updated = [...updated, task];
          }
        }
        return updated;
      });

      // Fire-and-forget: idempotent server-side tracking
      for (const task of found) {
        window.api.chat.trackTask(sessionId, task.id).catch(() => { /* ignore */ });
      }
    });

    return () => { unsub(); };
  }, [sessionId]);

  // Subscribe to taskStatusChanged to update badges in real-time
  useEffect(() => {
    const unsub = window.api.on.taskStatusChanged((taskId: string, updatedTask: Task) => {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === taskId);
        if (idx < 0) return prev; // not in tracked set
        if (updatedTask.updatedAt <= prev[idx].updatedAt) return prev; // stale update
        const updated = [...prev];
        updated[idx] = updatedTask;
        return updated;
      });
    });

    return () => { unsub(); };
  }, []);

  return { tasks, isLoading };
}
