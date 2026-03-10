import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ChatMessage, AgentChatMessage, ChatImage, ChatImageRef } from '../../shared/types';

const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';

function convertDbMessages(dbMessages: ChatMessage[]): AgentChatMessage[] {
  const result: AgentChatMessage[] = [];
  for (const msg of dbMessages) {
    if (msg.role === 'user') {
      // Parse JSON envelope for messages with images
      let text = msg.content;
      let images: ChatImageRef[] | undefined;
      if (msg.content.startsWith('{')) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
            text = parsed.text;
            if (Array.isArray(parsed.images) && parsed.images.length > 0) {
              images = parsed.images as ChatImageRef[];
            }
          }
        } catch (err) {
          console.warn('[useChat] User message starts with { but failed JSON parse:', err);
        }
      }
      result.push({ type: 'user' as const, text, images, timestamp: msg.createdAt });
    } else if (msg.role === 'system') {
      result.push({ type: 'status' as const, status: 'completed' as const, message: msg.content, timestamp: msg.createdAt });
    } else if (msg.role === 'assistant') {
      // Try to parse JSON array of structured messages; fall back to legacy plain text
      try {
        const parsed = JSON.parse(msg.content);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.type) {
          result.push(...(parsed as AgentChatMessage[]));
          continue;
        }
      } catch { /* legacy plain text */ }
      result.push({ type: 'assistant_text' as const, text: msg.content, timestamp: msg.createdAt });
    }
  }
  return result;
}

interface QueuedMessage {
  text: string;
  images?: ChatImage[];
}

export function useChat(sessionId: string | null) {
  const [dbMessages, setDbMessages] = useState<ChatMessage[]>([]);
  const [streamingMessages, setStreamingMessages] = useState<AgentChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMessage, setQueuedMessage] = useState<QueuedMessage | null>(null);
  const streamingRef = useRef(false);
  const doSendRef = useRef<(message: string, images?: ChatImage[]) => Promise<void>>(null);

  // Load messages on mount or session change
  useEffect(() => {
    // Clear all state when session changes to avoid cross-session leaks
    setDbMessages([]);
    setStreamingMessages([]);
    setIsStreaming(false);
    setQueuedMessage(null);
    streamingRef.current = false;
    setError(null);

    if (!sessionId) {
      return;
    }

    setLoading(true);
    window.api.chat.messages(sessionId)
      .then(setDbMessages)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));

    // Reconnect to in-flight session: seed streaming state from live turn messages
    window.api.chat.chatLiveMessages(sessionId)
      .then((liveMessages) => {
        if (liveMessages.length > 0) {
          setStreamingMessages(liveMessages);
          streamingRef.current = true;
          setIsStreaming(true);
        }
      })
      .catch(() => { /* session not running, ignore */ });
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

  const doSend = useCallback(async (message: string, images?: ChatImage[]) => {
    if (!sessionId || (!message.trim() && (!images || images.length === 0))) return;

    setError(null);
    setStreamingMessages([]);
    streamingRef.current = false;
    setIsStreaming(true);

    try {
      const { userMessage } = await window.api.chat.send(sessionId, message, images);
      // Optimistically add user message
      setDbMessages((prev) => [...prev, userMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsStreaming(false);
      streamingRef.current = false;
    }
  }, [sessionId]);

  // Keep doSendRef in sync
  doSendRef.current = doSend;

  // Auto-send queued message when streaming completes
  useEffect(() => {
    if (!isStreaming && queuedMessage) {
      const { text, images } = queuedMessage;
      setQueuedMessage(null);
      doSendRef.current?.(text, images);
    }
  }, [isStreaming, queuedMessage]);

  const sendMessage = useCallback(async (message: string, images?: ChatImage[]) => {
    if (!sessionId || (!message.trim() && (!images || images.length === 0))) return;

    // Queue the message if an agent is already running
    if (isStreaming) {
      setQueuedMessage({ text: message, images });
      return;
    }

    doSend(message, images);
  }, [sessionId, isStreaming, doSend]);

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
    let lastContextInputTokens: number | null = null;
    // Sum from DB messages (costInputTokens / costOutputTokens fields)
    for (const msg of dbMessages) {
      if (msg.costInputTokens != null) inputTokens += msg.costInputTokens;
      if (msg.costOutputTokens != null) outputTokens += msg.costOutputTokens;
      // Track the most recent non-null lastContextInputTokens (last turn's context size)
      if (msg.lastContextInputTokens != null) lastContextInputTokens = msg.lastContextInputTokens;
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
    return {
      inputTokens: inputTokens + streamInput,
      outputTokens: outputTokens + streamOutput,
      lastContextInputTokens,
    };
  }, [dbMessages, streamingMessages]);

  const clearError = useCallback(() => setError(null), []);

  return {
    messages,
    isStreaming,
    isQueued: queuedMessage !== null,
    loading,
    error,
    clearError,
    sendMessage,
    stopChat,
    clearChat,
    summarizeChat,
    tokenUsage,
  };
}
