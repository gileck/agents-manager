import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ChatMessage, AgentChatMessage } from '../../shared/types';

const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';

function convertDbMessages(dbMessages: ChatMessage[]): AgentChatMessage[] {
  return dbMessages.map((msg) => {
    if (msg.role === 'user') {
      return { type: 'user' as const, text: msg.content, timestamp: msg.createdAt };
    }
    if (msg.role === 'system') {
      return { type: 'status' as const, status: 'completed' as const, message: msg.content, timestamp: msg.createdAt };
    }
    return { type: 'assistant_text' as const, text: msg.content, timestamp: msg.createdAt };
  });
}

export function useChat(projectId: string | null) {
  const [dbMessages, setDbMessages] = useState<ChatMessage[]>([]);
  const [streamingMessages, setStreamingMessages] = useState<AgentChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamingRef = useRef(false);

  // Load messages on mount or project change
  useEffect(() => {
    if (!projectId) {
      setDbMessages([]);
      return;
    }

    setLoading(true);
    setError(null);
    window.api.chat.messages(projectId)
      .then(setDbMessages)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Subscribe to chat output (for streaming state and completion sentinel)
  useEffect(() => {
    if (!projectId) return;

    const unsubscribe = window.api.on.chatOutput((incomingProjectId: string, chunk: string) => {
      if (incomingProjectId !== projectId) return;

      if (chunk === CHAT_COMPLETE_SENTINEL) {
        streamingRef.current = false;
        setIsStreaming(false);
        setStreamingMessages([]);
        // Reload messages from DB
        window.api.chat.messages(projectId)
          .then(setDbMessages)
          .catch((err: Error) => setError(`Failed to reload messages: ${err.message}`));
        return;
      }

      if (!streamingRef.current) {
        streamingRef.current = true;
        setIsStreaming(true);
      }
    });

    return () => { unsubscribe(); };
  }, [projectId]);

  // Subscribe to structured chat messages
  useEffect(() => {
    if (!projectId) return;

    const unsubscribe = window.api.on.chatMessage((incomingProjectId: string, msg: AgentChatMessage) => {
      if (incomingProjectId !== projectId) return;
      setStreamingMessages((prev) => [...prev, msg]);
    });

    return () => { unsubscribe(); };
  }, [projectId]);

  const sendMessage = useCallback(async (message: string) => {
    if (!projectId || !message.trim()) return;

    setError(null);
    setStreamingMessages([]);
    setIsStreaming(true);
    streamingRef.current = true;

    try {
      const { userMessage } = await window.api.chat.send(projectId, message);
      // Optimistically add user message
      setDbMessages((prev) => [...prev, userMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsStreaming(false);
      streamingRef.current = false;
    }
  }, [projectId]);

  const stopChat = useCallback(() => {
    if (!projectId) return;
    window.api.chat.stop(projectId).catch((err: Error) => {
      setError(`Failed to stop chat: ${err.message}`);
    });
  }, [projectId]);

  const clearChat = useCallback(async () => {
    if (!projectId) return;
    try {
      await window.api.chat.clear(projectId);
      setDbMessages([]);
      setStreamingMessages([]);
      setIsStreaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  const summarizeChat = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const summaryMessages = await window.api.chat.summarize(projectId);
      setDbMessages(summaryMessages);
      setStreamingMessages([]);
      setIsStreaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Combine converted DB messages with streaming messages (memoized)
  const messages = useMemo<AgentChatMessage[]>(
    () => [...convertDbMessages(dbMessages), ...streamingMessages],
    [dbMessages, streamingMessages],
  );

  return {
    messages,
    isStreaming,
    loading,
    error,
    sendMessage,
    stopChat,
    clearChat,
    summarizeChat,
  };
}
