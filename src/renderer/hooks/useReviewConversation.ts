import { useState, useEffect, useCallback, useRef } from 'react';
import type { AgentChatMessage, ChatSession, PermissionMode } from '../../shared/types';
import { reportError } from '../lib/error-handler';

const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';

/**
 * Bridges TaskContextEntry (the persisted data source) with agent-chat (real-time streaming).
 * Does NOT use useChat to avoid double-storing messages — manages its own WS subscriptions.
 */
export function useReviewConversation(
  taskId: string | undefined,
  agentRole: string | undefined,
  entryType: string,
  onEntriesChanged: () => void,
) {
  const [session, setSession] = useState<ChatSession | null>(null);
  const [streamingMessages, setStreamingMessages] = useState<AgentChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamingRef = useRef(false);
  const sessionPromiseRef = useRef<Promise<ChatSession | null> | null>(null);
  const onEntriesChangedRef = useRef(onEntriesChanged);
  onEntriesChangedRef.current = onEntriesChanged;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // Eager session init: get/create agent-chat session on mount.
  // Uses a promise ref to deduplicate concurrent calls.
  useEffect(() => {
    if (!taskId || !agentRole) return;
    if (sessionRef.current) return;
    if (!sessionPromiseRef.current) {
      sessionPromiseRef.current = window.api.chatSession.getAgentChatSession(taskId, agentRole)
        .then((s) => { setSession(s); return s; })
        .catch((err) => {
          sessionPromiseRef.current = null;
          reportError(err instanceof Error ? err : new Error(String(err)), 'useReviewConversation');
          return null;
        });
    }
  }, [taskId, agentRole]);

  // Lazy session init: get/create agent-chat session on demand (e.g. first sendMessage).
  // Uses a promise ref to deduplicate concurrent calls.
  const ensureSession = useCallback(async (): Promise<ChatSession | null> => {
    if (session) return session;
    if (!taskId || !agentRole) return null;
    if (!sessionPromiseRef.current) {
      sessionPromiseRef.current = window.api.chatSession.getAgentChatSession(taskId, agentRole)
        .then((s) => { setSession(s); return s; })
        .catch((err) => {
          sessionPromiseRef.current = null;
          reportError(err instanceof Error ? err : new Error(String(err)), 'useReviewConversation');
          return null;
        });
    }
    return sessionPromiseRef.current;
  }, [session, taskId, agentRole]);

  // Subscribe to WS events when session exists
  useEffect(() => {
    if (!session) return;
    const sessionId = session.id;

    const unsubOutput = window.api.on.chatOutput((incomingId: string, chunk: string) => {
      if (incomingId !== sessionId) return;

      if (chunk === CHAT_COMPLETE_SENTINEL) {
        streamingRef.current = false;
        setIsStreaming(false);

        // Extract assistant text from completed response and save as TaskContextEntry
        window.api.chat.messages(sessionId)
          .then((dbMessages) => {
            // Find last assistant message
            const lastAssistant = [...dbMessages].reverse().find(m => m.role === 'assistant');
            if (!lastAssistant || !taskId) return;

            // Extract plain text from structured messages
            let responseText = lastAssistant.content;
            try {
              const parsed = JSON.parse(lastAssistant.content);
              if (Array.isArray(parsed)) {
                responseText = parsed
                  .filter((m: AgentChatMessage) => m.type === 'assistant_text')
                  .map((m: AgentChatMessage) => (m as { text: string }).text)
                  .join('\n');
              }
            } catch {
              // Expected for plain text content — responseText remains as the raw string.
            }

            if (responseText.trim()) {
              window.api.tasks.addFeedback(taskId, {
                entryType,
                content: responseText.trim(),
                source: agentRole,
                agentRunId: sessionRef.current?.agentRunId ?? undefined,
              }).then(() => {
                onEntriesChangedRef.current();
              }).catch((err: unknown) => {
                reportError(err instanceof Error ? err : new Error(String(err)), 'Save agent response as context');
              });
            }
          })
          .catch((err: unknown) => {
            reportError(err instanceof Error ? err : new Error(String(err)), 'Reload chat messages');
          })
          .finally(() => {
            setStreamingMessages([]);
          });
        return;
      }

      if (!streamingRef.current) {
        streamingRef.current = true;
        setIsStreaming(true);
      }
    });

    const unsubMsg = window.api.on.chatMessage((incomingId: string, msg: AgentChatMessage) => {
      if (incomingId !== sessionId) return;
      if (!streamingRef.current) return; // ignore messages after completion
      setStreamingMessages((prev) => [...prev, msg]);
    });

    return () => {
      unsubOutput();
      unsubMsg();
    };
  }, [session, taskId, agentRole, entryType]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || !taskId) return;

    // 1. Save user message as TaskContextEntry
    try {
      await window.api.tasks.addFeedback(taskId, { entryType, content: text.trim() });
      onEntriesChangedRef.current();
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), 'Save user review message');
      return;
    }

    // 2. Send to agent-chat for real-time response
    const s = await ensureSession();
    if (!s) {
      reportError(new Error('Failed to initialize chat session'), 'Review conversation session init');
      return;
    }

    setStreamingMessages([]);
    streamingRef.current = false;
    setIsStreaming(true);

    try {
      await window.api.chat.send(s.id, text);
    } catch (err) {
      setIsStreaming(false);
      streamingRef.current = false;
      reportError(err instanceof Error ? err : new Error(String(err)), 'Send review message');
    }
  }, [taskId, entryType, ensureSession]);

  const stopChat = useCallback(() => {
    if (!session) return;
    window.api.chat.stop(session.id).catch((err: unknown) => {
      reportError(err instanceof Error ? err : new Error(String(err)), 'Stop review chat');
    });
  }, [session]);

  const updatePermissionMode = useCallback(async (mode: PermissionMode) => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const updated = await window.api.chatSession.update(s.id, { permissionMode: mode });
      if (updated) setSession(updated);
    } catch (err) {
      reportError(err instanceof Error ? err : new Error(String(err)), 'Update permission mode');
    }
  }, []);

  return { session, streamingMessages, isStreaming, sendMessage, stopChat, updatePermissionMode };
}
