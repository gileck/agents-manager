import { useState, useEffect } from 'react';
import type { AgentRun } from '../../shared/types';

/**
 * Hook that listens for AGENT_INTERRUPTED_RUNS push events from the main process.
 * These are sent on startup when orphaned agent runs are recovered.
 */
export function useInterruptedRuns() {
  const [interruptedRuns, setInterruptedRuns] = useState<AgentRun[]>([]);

  useEffect(() => {
    const unsubscribe = window.api.on.agentInterruptedRuns((runs) => {
      setInterruptedRuns(runs);
    });
    return () => { unsubscribe(); };
  }, []);

  const dismiss = () => setInterruptedRuns([]);

  return { interruptedRuns, dismiss };
}
