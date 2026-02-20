import React, { createContext, useContext, useEffect, useRef, useCallback, useState } from 'react';
import type { AgentChatMessage, AgentRunStatus } from '../../shared/types';

const TERMINAL_STATUSES: AgentRunStatus[] = ['completed', 'failed', 'cancelled', 'timed_out'];

interface AgentStreamState {
  getMessages(taskId: string): AgentChatMessage[];
  addMessage(taskId: string, msg: AgentChatMessage): void;
  clearMessages(taskId: string): void;
  isActive(taskId: string): boolean;
  activeTaskIds: Set<string>;
}

const AgentStreamContext = createContext<AgentStreamState | null>(null);

export function AgentStreamProvider({ children }: { children: React.ReactNode }) {
  const messagesRef = useRef(new Map<string, AgentChatMessage[]>());
  const activeRef = useRef(new Set<string>());
  const [, setRevision] = useState(0);

  const bump = useCallback(() => setRevision((r) => r + 1), []);

  const getMessages = useCallback((taskId: string): AgentChatMessage[] => {
    return messagesRef.current.get(taskId) || [];
  }, []);

  const addMessage = useCallback((taskId: string, msg: AgentChatMessage) => {
    const current = messagesRef.current.get(taskId) || [];
    current.push(msg);
    messagesRef.current.set(taskId, current);
    bump();
  }, [bump]);

  const clearMessages = useCallback((taskId: string) => {
    messagesRef.current.delete(taskId);
    bump();
  }, [bump]);

  const isActive = useCallback((taskId: string): boolean => {
    return activeRef.current.has(taskId);
  }, []);

  const activeTaskIds = activeRef.current;

  // Subscribe to IPC events globally
  useEffect(() => {
    const unsubMessage = window.api?.on?.agentMessage?.((taskId: string, msg: AgentChatMessage) => {
      addMessage(taskId, msg);
      // Mark active on non-status messages (status messages handled by agentStatus listener)
      if (msg.type !== 'status') {
        activeRef.current.add(taskId);
        bump();
      }
    });

    const unsubOutput = window.api?.on?.agentOutput?.((taskId: string) => {
      if (!activeRef.current.has(taskId)) {
        activeRef.current.add(taskId);
        bump();
      }
    });

    const unsubStatus = window.api?.on?.agentStatus?.((taskId: string, status: AgentRunStatus) => {
      // Only deactivate on terminal statuses to avoid flash during follow-up runs
      if (TERMINAL_STATUSES.includes(status)) {
        activeRef.current.delete(taskId);
        bump();
      }
    });

    return () => {
      unsubMessage?.();
      unsubOutput?.();
      unsubStatus?.();
    };
  }, [addMessage, bump]);

  return (
    <AgentStreamContext.Provider value={{ getMessages, addMessage, clearMessages, isActive, activeTaskIds }}>
      {children}
    </AgentStreamContext.Provider>
  );
}

export function useAgentStream() {
  const ctx = useContext(AgentStreamContext);
  if (!ctx) throw new Error('useAgentStream must be used within AgentStreamProvider');
  return ctx;
}
