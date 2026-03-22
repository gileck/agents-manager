import { useEffect, useRef } from 'react';

interface Refetchers {
  refetch: () => void;
  refetchTransitions: () => void;
  refetchAgentRuns: () => void;
  refetchPrompts: () => void;
  refetchDebug: () => void;
  refetchContext: () => void;
  refetchDocs?: () => void;
}

/**
 * Polls all task-related data on a 3-second interval while `shouldPoll` is true,
 * and performs a full flush when `hasRunningAgent` transitions from true to false
 * (completion edge).
 */
export function useTaskPolling(
  taskId: string | undefined,
  shouldPoll: boolean,
  hasRunningAgent: boolean,
  refetchers: Refetchers,
): void {
  const { refetch, refetchTransitions, refetchAgentRuns, refetchPrompts, refetchDebug, refetchContext, refetchDocs } = refetchers;

  // 3-second polling interval while shouldPoll is true
  useEffect(() => {
    if (!shouldPoll || !taskId) return;
    const interval = setInterval(() => {
      refetchAgentRuns();
      refetch();
      refetchTransitions();
      refetchPrompts();
      refetchDebug();
      refetchContext();
      refetchDocs?.();
    }, 3000);
    return () => clearInterval(interval);
  }, [taskId, shouldPoll, refetchAgentRuns, refetch, refetchTransitions, refetchPrompts, refetchDebug, refetchContext, refetchDocs]);

  // Completion edge: full refresh when agent finishes
  const prevHasRunning = useRef(hasRunningAgent);
  useEffect(() => {
    if (prevHasRunning.current && !hasRunningAgent) {
      refetch();
      refetchTransitions();
      refetchAgentRuns();
      refetchPrompts();
      refetchDebug();
      refetchContext();
      refetchDocs?.();
    }
    prevHasRunning.current = hasRunningAgent;
  }, [hasRunningAgent, refetch, refetchTransitions, refetchAgentRuns, refetchPrompts, refetchDebug, refetchContext, refetchDocs]);
}
