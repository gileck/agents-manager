import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ChatMessage, AgentChatMessage, ChatImage, AgentNotificationPayload, ChatSessionStatus } from '../../shared/types';
import { convertDbMessages } from '../../shared/convert-db-messages';

const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';
const STATUS_POLL_INTERVAL_MS = 5000;

export interface RawEvent {
  timestamp: string;
  channel: string;
  payload: unknown;
}

interface QueuedMessage {
  text: string;
  images?: ChatImage[];
}

export function useChat(sessionId: string | null, options?: { enableStreamingInput?: boolean }) {
  const enableStreamingInput = options?.enableStreamingInput ?? true;
  const [dbMessages, setDbMessages] = useState<ChatMessage[]>([]);
  const [streamingMessages, setStreamingMessages] = useState<AgentChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedMessage, setQueuedMessage] = useState<QueuedMessage | null>(null);
  const [rawEvents, setRawEvents] = useState<RawEvent[]>([]);
  const [serverStatus, setServerStatus] = useState<ChatSessionStatus>('idle');
  // streamingRef provides instant UI responsiveness (set true on send, false on sentinel).
  // serverStatus is the authoritative fallback for recovery.
  const streamingRef = useRef(false);
  const doSendRef = useRef<(message: string, images?: ChatImage[]) => Promise<void>>(null);

  // Derive isStreaming from combined sources
  const isStreaming = serverStatus === 'running' || serverStatus === 'waiting_for_input' || streamingRef.current;
  const isWaitingForInput = serverStatus === 'waiting_for_input';

  // Load messages on mount or session change
  useEffect(() => {
    // Clear all state when session changes to avoid cross-session leaks
    setDbMessages([]);
    setStreamingMessages([]);
    streamingRef.current = false;
    setServerStatus('idle');
    setQueuedMessage(null);
    setError(null);
    setRawEvents([]);

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
        }
      })
      .catch(() => { /* session not running, ignore */ });

    // Fetch server-authoritative status to detect in-flight sessions
    window.api.chat.sessionStatus(sessionId)
      .then(({ status }) => {
        setServerStatus(status);
        if (status === 'running' || status === 'waiting_for_input') {
          streamingRef.current = true;
        }
      })
      .catch(() => { /* ignore */ });
  }, [sessionId]);

  // Subscribe to chat output (for streaming state and completion sentinel)
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.api.on.chatOutput((incomingProjectId: string, chunk: string) => {
      if (incomingProjectId !== sessionId) return;
      setRawEvents((prev) => [...prev, { timestamp: new Date().toISOString(), channel: 'chat:output', payload: chunk }]);

      if (chunk === CHAT_COMPLETE_SENTINEL) {
        streamingRef.current = false;
        setServerStatus('idle');
        // Reload messages from DB, then clear streaming messages so there is
        // no frame where the streaming content has been removed but the DB
        // messages haven't arrived yet (which would collapse the scroll
        // height and trick auto-scroll into jumping to the bottom).
        window.api.chat.messages(sessionId)
          .then((freshMessages) => {
            setDbMessages(freshMessages);
            setStreamingMessages([]);
          })
          .catch((err: Error) => setError(`Failed to reload messages: ${err.message}`));
        return;
      }

      if (!streamingRef.current) {
        streamingRef.current = true;
        setServerStatus('running');
      }
    });

    return () => { unsubscribe(); };
  }, [sessionId]);

  // Subscribe to structured chat messages
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.api.on.chatMessage((incomingProjectId: string, msg: AgentChatMessage) => {
      if (incomingProjectId !== sessionId) return;
      setRawEvents((prev) => [...prev, { timestamp: new Date().toISOString(), channel: 'chat:message', payload: msg }]);
      setStreamingMessages((prev) => [...prev, msg]);
    });

    return () => { unsubscribe(); };
  }, [sessionId]);

  // Subscribe to stream delta events (partial message streaming)
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.api.on.chatStreamDelta((incomingSessionId: string, delta: AgentChatMessage) => {
      if (incomingSessionId !== sessionId) return;
      setRawEvents((prev) => [...prev, { timestamp: new Date().toISOString(), channel: 'chat:stream-delta', payload: delta }]);
      setStreamingMessages((prev) => [...prev, delta]);
    });

    return () => { unsubscribe(); };
  }, [sessionId]);

  // Subscribe to permission request events
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.api.on.chatPermissionRequest((incomingSessionId: string, request: AgentChatMessage) => {
      if (incomingSessionId !== sessionId) return;
      setRawEvents((prev) => [...prev, { timestamp: new Date().toISOString(), channel: 'chat:permission-request', payload: request }]);
      setStreamingMessages((prev) => [...prev, request]);
    });

    return () => { unsubscribe(); };
  }, [sessionId]);

  // Subscribe to agent notification events (Tier 1 WS push)
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.api.on.chatAgentNotification((incomingSessionId: string, payload: AgentNotificationPayload) => {
      if (incomingSessionId !== sessionId) return;
      setRawEvents((prev) => [...prev, { timestamp: new Date().toISOString(), channel: 'chat:agent-notification', payload }]);
      // Skip Tier 1 rendering when autoNotify is true — Tier 2 handles it
      // via the injected event handler which triggers a full agent turn.
      if (payload.autoNotify) return;

      const notification: AgentChatMessage = {
        type: 'notification',
        title: `Task "${payload.taskTitle}" completed`,
        body: `Agent ${payload.agentType} completed with outcome "${payload.outcome}".` +
          (payload.summary ? ` Summary: ${payload.summary}` : ''),
        timestamp: Date.now(),
      };
      setStreamingMessages((prev) => [...prev, notification]);
    });

    return () => { unsubscribe(); };
  }, [sessionId]);

  // Polling heartbeat: when we think the agent is running, poll server status
  // every few seconds. If the server says idle/error but we still think streaming,
  // self-heal by resetting state and reloading messages from DB.
  useEffect(() => {
    if (!sessionId || !isStreaming) return;

    const interval = setInterval(async () => {
      if (!isStreaming) return; // re-check inside interval
      try {
        const { status } = await window.api.chat.sessionStatus(sessionId);
        setServerStatus(status);
        if (status === 'idle' || status === 'error') {
          // Sentinel was missed — self-heal
          streamingRef.current = false;
          const freshMessages = await window.api.chat.messages(sessionId);
          setDbMessages(freshMessages);
          setStreamingMessages([]);
        }
      } catch {
        /* ignore network errors during poll */
      }
    }, STATUS_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [sessionId, isStreaming]);

  const doSend = useCallback(async (message: string, images?: ChatImage[]) => {
    if (!sessionId || (!message.trim() && (!images || images.length === 0))) return;

    setError(null);
    setStreamingMessages([]);
    streamingRef.current = true;
    setServerStatus('running');

    try {
      const { userMessage } = await window.api.chat.send(sessionId, message, images);
      // Optimistically add user message
      setDbMessages((prev) => [...prev, userMessage]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('agent is already running')) {
        // Race condition: server still has an agent running but React isStreaming was stale.
        // Queue the message silently; the auto-send effect will retry when streaming ends.
        setQueuedMessage({ text: message, images });
        // Keep streaming state true; the chatOutput sentinel will clear it when done.
      } else {
        setError(errMsg);
        streamingRef.current = false;
        setServerStatus('idle');
      }
    }
  }, [sessionId]);

  // Inject a message into a running agent without resetting streaming state
  const doInject = useCallback(async (message: string, images?: ChatImage[]) => {
    if (!sessionId || (!message.trim() && (!images || images.length === 0))) return;

    setError(null);
    try {
      const { userMessage } = await window.api.chat.send(sessionId, message, images);
      // Optimistically add the injected user message to DB messages
      setDbMessages((prev) => [...prev, userMessage]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // If injection fails (e.g. server doesn't support it), fall back to queuing
      setQueuedMessage({ text: message, images });
      if (!errMsg.includes('agent is already running')) {
        setError(errMsg);
      }
    }
  }, [sessionId]);

  // Keep doSendRef in sync
  doSendRef.current = doSend;

  // Auto-send queued message when streaming completes or sessionId becomes available
  useEffect(() => {
    if (sessionId && !isStreaming && queuedMessage) {
      const { text, images } = queuedMessage;
      setQueuedMessage(null);
      doSendRef.current?.(text, images);
    }
  }, [sessionId, isStreaming, queuedMessage]);

  const answerQuestion = useCallback(async (questionId: string, answers: Record<string, string>) => {
    if (!sessionId) return;
    try {
      await window.api.chat.answerQuestion(sessionId, questionId, answers);
      // Optimistically update the streaming message to answered
      setStreamingMessages((prev) =>
        prev.map((msg) =>
          msg.type === 'ask_user_question' && msg.questionId === questionId
            ? { ...msg, answered: true, answers }
            : msg,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId]);

  const sendMessage = useCallback(async (message: string, images?: ChatImage[]) => {
    // Bug 1 fix: when sessionId is null, show an error instead of silently dropping
    if (!sessionId) {
      if (message.trim() || (images && images.length > 0)) {
        setError('Session not ready — please try again');
      }
      return;
    }
    if (!message.trim() && (!images || images.length === 0)) return;

    if (isStreaming) {
      // Check if the agent is waiting for a question answer — route the message as the answer
      // Only for single-question scenarios; multi-question should use the pill buttons
      const pendingQuestion = [...streamingMessages].reverse().find(
        (msg) => msg.type === 'ask_user_question' && !msg.answered
      );
      if (pendingQuestion && pendingQuestion.type === 'ask_user_question' && pendingQuestion.questions.length === 1) {
        // Route the user's message as the answer (ignore images — answers are text-only)
        answerQuestion(pendingQuestion.questionId, { [pendingQuestion.questions[0].question]: message });
        return;
      }

      if (enableStreamingInput) {
        // Injection mode: send directly to running agent without resetting streaming state
        doInject(message, images);
      } else {
        // Queue the message for later
        setQueuedMessage({ text: message, images });
      }
      return;
    }

    doSend(message, images);
  }, [sessionId, isStreaming, enableStreamingInput, doSend, doInject, streamingMessages, answerQuestion]);

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
      streamingRef.current = false;
      setServerStatus('idle');
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
      streamingRef.current = false;
      setServerStatus('idle');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Combine converted DB messages with streaming messages (memoized).
  // Stream deltas are merged into accumulated text/thinking blocks for display.
  const messages = useMemo<AgentChatMessage[]>(() => {
    const base = convertDbMessages(dbMessages);
    // Process streaming messages: merge consecutive stream_delta into text/thinking blocks
    const processed: AgentChatMessage[] = [];
    let pendingText = '';
    let pendingThinking = '';

    const flushPending = () => {
      if (pendingText) {
        processed.push({ type: 'assistant_text', text: pendingText, timestamp: Date.now() });
        pendingText = '';
      }
      if (pendingThinking) {
        processed.push({ type: 'thinking', text: pendingThinking, timestamp: Date.now() });
        pendingThinking = '';
      }
    };

    for (const msg of streamingMessages) {
      if (msg.type === 'stream_delta') {
        if (msg.deltaType === 'text_delta') {
          pendingText += msg.delta;
        } else if (msg.deltaType === 'thinking_delta') {
          pendingThinking += msg.delta;
        }
        // input_json_delta is not displayed directly — it's part of tool input
      } else {
        // When any full message arrives, discard ALL accumulated deltas
        // (both types) since full messages supersede the stream delta preview
        pendingText = '';
        pendingThinking = '';
        processed.push(msg);
      }
    }
    flushPending();

    return [...base, ...processed];
  }, [dbMessages, streamingMessages]);

  // Compute token usage from DB messages + streaming usage messages
  const tokenUsage = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadInputTokens = 0;
    let cacheCreationInputTokens = 0;
    let totalCostUsd = 0;
    let lastContextInputTokens: number | null = null;
    let contextWindow: number | null = null;
    // Sum from DB messages (costInputTokens / costOutputTokens fields)
    for (const msg of dbMessages) {
      if (msg.costInputTokens != null) inputTokens += msg.costInputTokens;
      if (msg.costOutputTokens != null) outputTokens += msg.costOutputTokens;
      if (msg.cacheReadInputTokens != null) cacheReadInputTokens += msg.cacheReadInputTokens;
      if (msg.cacheCreationInputTokens != null) cacheCreationInputTokens += msg.cacheCreationInputTokens;
      if (msg.totalCostUsd != null) totalCostUsd += msg.totalCostUsd;
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
        if (msg.contextWindow) contextWindow = msg.contextWindow;
        if (msg.lastContextInputTokens != null) lastContextInputTokens = msg.lastContextInputTokens;
      }
    }
    return {
      inputTokens: inputTokens + streamInput,
      outputTokens: outputTokens + streamOutput,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      totalCostUsd,
      lastContextInputTokens,
      contextWindow,
    };
  }, [dbMessages, streamingMessages]);

  // Build per-turn usage array from assistant DB messages that have cost data
  const perTurnUsage = useMemo(() => {
    let turnIndex = 0;
    const turns: Array<{
      turn: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalCostUsd: number;
    }> = [];
    for (const msg of dbMessages) {
      if (msg.role === 'assistant' && msg.costInputTokens != null) {
        turnIndex++;
        turns.push({
          turn: turnIndex,
          inputTokens: msg.costInputTokens ?? 0,
          outputTokens: msg.costOutputTokens ?? 0,
          cacheReadTokens: msg.cacheReadInputTokens ?? 0,
          cacheWriteTokens: msg.cacheCreationInputTokens ?? 0,
          totalCostUsd: msg.totalCostUsd ?? 0,
        });
      }
    }
    return turns;
  }, [dbMessages]);

  const respondToPermission = useCallback(async (requestId: string, allowed: boolean) => {
    if (!sessionId) return;
    try {
      await window.api.chat.permissionResponse(sessionId, requestId, allowed);
      // Update the permission_request message in streaming messages to show the response
      setStreamingMessages((prev) => [
        ...prev,
        { type: 'permission_response' as const, requestId, allowed, timestamp: Date.now() },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sessionId]);

  const cancelQueuedMessage = useCallback(() => setQueuedMessage(null), []);

  const clearError = useCallback(() => setError(null), []);

  return {
    messages,
    isStreaming,
    isWaitingForInput,
    isQueued: queuedMessage !== null,
    loading,
    error,
    clearError,
    sendMessage,
    answerQuestion,
    stopChat,
    cancelQueuedMessage,
    clearChat,
    summarizeChat,
    tokenUsage,
    perTurnUsage,
    respondToPermission,
    rawEvents,
  };
}
