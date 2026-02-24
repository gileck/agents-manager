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

export function useTaskChat(taskId: string | null) {
  const [dbMessages, setDbMessages] = useState<ChatMessage[]>([]);
  const [streamingMessages, setStreamingMessages] = useState<AgentChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamingRef = useRef(false);

  // Load messages on mount or taskId change
  useEffect(() => {
    if (!taskId) {
      setDbMessages([]);
      return;
    }

    setLoading(true);
    setError(null);
    window.api.taskChat.messages(taskId)
      .then(setDbMessages)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [taskId]);

  // Subscribe to task chat output (streaming state + completion sentinel)
  useEffect(() => {
    if (!taskId) return;

    const unsubscribe = window.api.on.taskChatOutput((incomingTaskId: string, chunk: string) => {
      if (incomingTaskId !== taskId) return;

      if (chunk === CHAT_COMPLETE_SENTINEL) {
        // Only process sentinel for the current session
        if (!streamingRef.current) return;
        streamingRef.current = false;
        setIsStreaming(false);
        // Keep streaming messages as-is (they have the full turn including tools + text).
        // DB reload happens on next sendMessage to avoid race conditions.
        return;
      }

      if (!streamingRef.current) {
        streamingRef.current = true;
        setIsStreaming(true);
      }
    });

    return () => { unsubscribe(); };
  }, [taskId]);

  // Subscribe to structured task chat messages
  useEffect(() => {
    if (!taskId) return;

    const unsubscribe = window.api.on.taskChatMessage((incomingTaskId: string, msg: AgentChatMessage) => {
      if (incomingTaskId !== taskId) return;
      setStreamingMessages((prev) => [...prev, msg]);
    });

    return () => { unsubscribe(); };
  }, [taskId]);

  const sendMessage = useCallback(async (message: string) => {
    if (!taskId || !message.trim()) return;

    setError(null);
    // Reload DB to capture previous turn's persisted messages, then clear streaming
    try {
      const fresh = await window.api.taskChat.messages(taskId);
      setDbMessages(fresh);
    } catch (err) { console.warn('[useTaskChat] DB reload failed, using cached state:', err); }
    setStreamingMessages([]);
    // Reset streamingRef before setting isStreaming so that a stale sentinel
    // arriving between now and the first chunk of the new stream is ignored
    streamingRef.current = false;
    setIsStreaming(true);

    try {
      const { userMessage } = await window.api.taskChat.send(taskId, message);
      setDbMessages((prev) => [...prev, userMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsStreaming(false);
      streamingRef.current = false;
    }
  }, [taskId]);

  const stopChat = useCallback(() => {
    if (!taskId) return;
    streamingRef.current = false;
    setIsStreaming(false);
    window.api.taskChat.stop(taskId).catch((err: Error) => {
      setError(`Failed to stop chat: ${err.message}`);
    });
  }, [taskId]);

  const clearChat = useCallback(async () => {
    if (!taskId) return;
    try {
      await window.api.taskChat.clear(taskId);
      streamingRef.current = false;
      setDbMessages([]);
      setStreamingMessages([]);
      setIsStreaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [taskId]);

  const messages = useMemo<AgentChatMessage[]>(
    () => [...convertDbMessages(dbMessages), ...streamingMessages],
    [dbMessages, streamingMessages],
  );

  const tokenUsage = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const msg of dbMessages) {
      if (msg.costInputTokens) inputTokens += msg.costInputTokens;
      if (msg.costOutputTokens) outputTokens += msg.costOutputTokens;
    }
    let streamInput = 0;
    let streamOutput = 0;
    for (const msg of streamingMessages) {
      if (msg.type === 'usage') {
        streamInput = msg.inputTokens;
        streamOutput = msg.outputTokens;
      }
    }
    return { inputTokens: inputTokens + streamInput, outputTokens: outputTokens + streamOutput };
  }, [dbMessages, streamingMessages]);

  return {
    messages,
    isStreaming,
    loading,
    error,
    sendMessage,
    stopChat,
    clearChat,
    tokenUsage,
  };
}
