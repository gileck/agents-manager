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

export function useChat(sessionId: string | null) {
  const [dbMessages, setDbMessages] = useState<ChatMessage[]>([]);
  const [streamingMessages, setStreamingMessages] = useState<AgentChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamingRef = useRef(false);

  // Load messages on mount or session change
  useEffect(() => {
    if (!sessionId) {
      setDbMessages([]);
      return;
    }

    setLoading(true);
    setError(null);
    window.api.chat.messages(sessionId)
      .then(setDbMessages)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  // Subscribe to chat output (for streaming state and completion sentinel)
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.api.on.chatOutput((incomingProjectId: string, chunk: string) => {
      if (incomingProjectId !== sessionId) return;

      if (chunk === CHAT_COMPLETE_SENTINEL) {
        streamingRef.current = false;
        setIsStreaming(false);
        setStreamingMessages([]);
        // Reload messages from DB
        window.api.chat.messages(sessionId)
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
  }, [sessionId]);

  // Subscribe to structured chat messages
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.api.on.chatMessage((incomingProjectId: string, msg: AgentChatMessage) => {
      if (incomingProjectId !== sessionId) return;
      setStreamingMessages((prev) => [...prev, msg]);
    });

    return () => { unsubscribe(); };
  }, [sessionId]);

  const sendMessage = useCallback(async (message: string) => {
    if (!sessionId || !message.trim()) return;

    setError(null);
    setStreamingMessages([]);
    setIsStreaming(true);
    streamingRef.current = true;

    try {
      const { userMessage } = await window.api.chat.send(sessionId, message);
      // Optimistically add user message
      setDbMessages((prev) => [...prev, userMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsStreaming(false);
      streamingRef.current = false;
    }
  }, [sessionId]);

  const stopChat = useCallback(() => {
    if (!sessionId) return;
    window.api.chat.stop(sessionId).catch((err: Error) => {
      setError(`Failed to stop chat: ${err.message}`);
    });
  }, [sessionId]);

  const clearChat = useCallback(async () => {
    if (!sessionId) return;
    try {
      await window.api.chat.clear(sessionId);
      setDbMessages([]);
      setStreamingMessages([]);
      setIsStreaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId]);

  const summarizeChat = useCallback(async () => {
    if (!sessionId) return;
    try {
      setLoading(true);
      const summaryMessages = await window.api.chat.summarize(sessionId);
      setDbMessages(summaryMessages);
      setStreamingMessages([]);
      setIsStreaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Combine converted DB messages with streaming messages (memoized)
  const messages = useMemo<AgentChatMessage[]>(
    () => [...convertDbMessages(dbMessages), ...streamingMessages],
    [dbMessages, streamingMessages],
  );

  // Compute token usage from DB messages + streaming usage messages
  const tokenUsage = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    // Sum from DB messages (costInputTokens / costOutputTokens fields)
    for (const msg of dbMessages) {
      if (msg.costInputTokens) inputTokens += msg.costInputTokens;
      if (msg.costOutputTokens) outputTokens += msg.costOutputTokens;
    }
    // Add latest streaming usage on top of DB totals
    // (SDK reports cumulative totals for the current turn only)
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
    summarizeChat,
    tokenUsage,
  };
}
