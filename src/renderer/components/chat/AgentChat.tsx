import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { AgentChatMessage, AgentRun, ChatImage, PermissionMode } from '../../../shared/types';
import type { RawEvent } from '../../hooks/useChat';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput, AgentLibOption, ModelOption } from './ChatInput';
import { ContextSidebar } from './ContextSidebar';
import { TaskStatusBar } from './TaskStatusBar';
import { RawChatView } from './RawChatView';

interface AgentChatProps {
  messages: AgentChatMessage[];
  isRunning: boolean;
  isQueued?: boolean;
  onSend: (message: string, images?: ChatImage[]) => void;
  onStop?: () => void;
  onCancelQueue?: () => void;
  showSidebar?: boolean;
  run?: AgentRun | null;
  emptyState?: React.ReactNode;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  agentLibs?: AgentLibOption[];
  selectedAgentLib?: string;
  onAgentLibChange?: (lib: string) => void;
  models?: ModelOption[];
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  permissionMode?: PermissionMode | null;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  sessionId?: string | null;
  initialDraft?: string | null;
  onDraftChange?: (draft: string) => void;
  onPermissionResponse?: (requestId: string, allowed: boolean) => void;
  rawEvents?: RawEvent[];
  showRawView?: boolean;
  enableStreamingInput?: boolean;
  isWaitingForInput?: boolean;
}

export function AgentChat({
  messages,
  isRunning,
  isQueued = false,
  onSend,
  onStop,
  onCancelQueue,
  showSidebar = false,
  run,
  emptyState,
  tokenUsage,
  agentLibs,
  selectedAgentLib,
  onAgentLibChange,
  models,
  selectedModel,
  onModelChange,
  permissionMode,
  onPermissionModeChange,
  inputRef,
  sessionId,
  initialDraft,
  onDraftChange,
  onPermissionResponse,
  rawEvents = [],
  showRawView = false,
  enableStreamingInput = false,
  isWaitingForInput = false,
}: AgentChatProps) {
  // Generate a unique key for the ChatInput to force remount on session changes.
  // When sessionId is null/undefined we use a monotonically-increasing counter
  // so that successive null sessions still get distinct keys.
  const nullKeyCounter = useRef(0);
  const inputKey = sessionId ?? `__no-session-${++nullKeyCounter.current}`;

  const [prefill, setPrefill] = useState<{ text: string; seq: number } | null>(null);

  const handleEditMessage = useCallback((text: string) => {
    setPrefill((prev) => ({ text, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleResume = useCallback((text: string) => {
    onSend(text);
  }, [onSend]);

  // Global Esc → stop agent
  useEffect(() => {
    if (!isRunning || !onStop) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onStop();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isRunning, onStop]);

  // Last user message text for Arrow-Up-to-edit
  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'user') return msg.text;
    }
    return undefined;
  }, [messages]);

  const handleEditLastMessage = useCallback(() => {
    if (lastUserMessage) handleEditMessage(lastUserMessage);
  }, [lastUserMessage, handleEditMessage]);

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-h-0 flex flex-col">
        {showRawView ? (
          <RawChatView rawEvents={rawEvents} />
        ) : messages.length === 0 && !isRunning && emptyState ? (
          <div className="flex-1 flex items-center justify-center px-6 py-4">
            {emptyState}
          </div>
        ) : (
          <ChatMessageList messages={messages} isRunning={isRunning} onEditMessage={handleEditMessage} onResume={handleResume} onPermissionResponse={onPermissionResponse} />
        )}
        <TaskStatusBar sessionId={sessionId ?? null} />
        <ChatInput
          key={inputKey}
          ref={inputRef}
          onSend={onSend}
          onStop={onStop}
          isRunning={isRunning}
          isQueued={isQueued}
          onCancelQueue={onCancelQueue}
          tokenUsage={tokenUsage}
          agentLibs={agentLibs}
          selectedAgentLib={selectedAgentLib}
          onAgentLibChange={onAgentLibChange}
          models={models}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          permissionMode={permissionMode}
          onPermissionModeChange={onPermissionModeChange}
          prefill={prefill}
          lastUserMessage={lastUserMessage}
          onEditLastMessage={handleEditLastMessage}
          initialDraft={initialDraft}
          onDraftChange={onDraftChange}
          enableStreamingInput={enableStreamingInput}
          isWaitingForInput={isWaitingForInput}
        />
      </div>
      {showSidebar && (
        <ContextSidebar messages={messages} run={run ?? null} />
      )}
    </div>
  );
}
