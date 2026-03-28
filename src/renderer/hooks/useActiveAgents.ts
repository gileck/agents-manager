import { useState, useEffect, useCallback } from 'react';
import type { RunningAgent, ChatSessionStatus } from '../../shared/types';

export function useActiveAgents() {
  const [agents, setAgents] = useState<RunningAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll for active agents
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const activeAgents = await window.api.chatSession.listAgents();
        setAgents(activeAgents);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    // Initial fetch
    setLoading(true);
    fetchAgents().finally(() => setLoading(false));

    // Poll every 5 seconds (individual session status is now server-authoritative via useChat)
    const intervalId = setInterval(fetchAgents, 5000);

    return () => clearInterval(intervalId);
  }, []);

  // Subscribe to push-based status change events
  useEffect(() => {
    const toAgentStatus = (s: ChatSessionStatus): RunningAgent['status'] => {
      if (s === 'error') return 'failed'; // map 'error' to 'failed' (the only non-overlapping value)
      return s as RunningAgent['status'];
    };
    const unsubscribe = window.api.on.chatSessionStatusChanged((sessionId: string, { status }) => {
      setAgents((prev) =>
        prev.map((agent) =>
          agent.sessionId === sessionId
            ? { ...agent, status: toAgentStatus(status), lastActivity: Date.now() }
            : agent
        )
      );
    });
    return () => { unsubscribe(); };
  }, []);

  const stopAgent = useCallback(async (sessionId: string) => {
    try {
      await window.api.chat.stop(sessionId);
      // Update local state immediately for responsiveness
      setAgents((prev) =>
        prev.map((agent) =>
          agent.sessionId === sessionId
            ? { ...agent, status: 'failed', lastActivity: Date.now() }
            : agent
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, []);

  // Get agents for a specific project
  const getProjectAgents = useCallback(
    (projectId: string) => {
      return agents.filter((agent) => agent.projectId === projectId);
    },
    [agents]
  );

  // Get agents for a specific session
  const getSessionAgents = useCallback(
    (sessionId: string) => {
      return agents.filter((agent) => agent.sessionId === sessionId);
    },
    [agents]
  );

  return {
    agents,
    loading,
    error,
    stopAgent,
    getProjectAgents,
    getSessionAgents,
  };
}