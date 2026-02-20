import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage } from '../../shared/types';

const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';

export function useChat(projectId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamingRef = useRef(false);

  // Load messages on mount or project change
  useEffect(() => {
    if (!projectId) {
      setMessages([]);
      return;
    }

    setLoading(true);
    setError(null);
    window.api.chat.messages(projectId)
      .then(setMessages)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Subscribe to chat output
  useEffect(() => {
    if (!projectId) return;

    const unsubscribe = window.api.on.chatOutput((incomingProjectId: string, chunk: string) => {
      if (incomingProjectId !== projectId) return;

      if (chunk === CHAT_COMPLETE_SENTINEL) {
        streamingRef.current = false;
        setIsStreaming(false);
        setStreamingContent('');
        // Reload messages from DB
        window.api.chat.messages(projectId).then(setMessages).catch(() => {});
        return;
      }

      if (!streamingRef.current) {
        streamingRef.current = true;
        setIsStreaming(true);
      }

      setStreamingContent((prev) => prev + chunk);
    });

    return () => { unsubscribe(); };
  }, [projectId]);

  const sendMessage = useCallback(async (message: string) => {
    if (!projectId || !message.trim()) return;

    setError(null);
    setStreamingContent('');

    try {
      const { userMessage } = await window.api.chat.send(projectId, message);
      // Optimistically add user message
      setMessages((prev) => [...prev, userMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [projectId]);

  const stopChat = useCallback(() => {
    if (!projectId) return;
    window.api.chat.stop(projectId).catch(() => {});
  }, [projectId]);

  const clearChat = useCallback(async () => {
    if (!projectId) return;
    try {
      await window.api.chat.clear(projectId);
      setMessages([]);
      setStreamingContent('');
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
      setMessages(summaryMessages);
      setStreamingContent('');
      setIsStreaming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  return {
    messages,
    streamingContent,
    isStreaming,
    loading,
    error,
    sendMessage,
    stopChat,
    clearChat,
    summarizeChat,
  };
}
