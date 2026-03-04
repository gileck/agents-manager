import React, { useState, useCallback, useEffect } from 'react';
import { AgentChat } from '../chat/AgentChat';
import { useChat } from '../../hooks/useChat';
import { InlineError } from '../InlineError';
import { reportError } from '../../lib/error-handler';
import type { ChatSession, AgentChatMode, ChatImage } from '../../../shared/types';
import { Button } from '../ui/button';

interface AgentChatPanelProps {
  taskId: string;
  agentRole: string;
  hasContent: boolean;
}

const MODE_OPTIONS: { value: AgentChatMode; label: string }[] = [
  { value: 'question', label: 'Question' },
  { value: 'changes', label: 'Request Changes' },
];

export function AgentChatPanel({ taskId, agentRole, hasContent }: AgentChatPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [session, setSession] = useState<ChatSession | null>(null);
  const [mode, setMode] = useState<AgentChatMode>('question');
  const [loadingSession, setLoadingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const { messages, isStreaming, isQueued, sendMessage, stopChat, tokenUsage } = useChat(session?.id ?? null);

  const roleName = agentRole.charAt(0).toUpperCase() + agentRole.slice(1);

  // Fetch/create agent-chat session on expand
  useEffect(() => {
    if (!expanded || session) return;
    setLoadingSession(true);
    window.api.chatSession.getAgentChatSession(taskId, agentRole)
      .then(setSession)
      .catch((err: Error) => {
        reportError(err, 'AgentChatPanel');
        setSessionError(err.message || 'Failed to load chat session');
      })
      .finally(() => setLoadingSession(false));
  }, [expanded, session, taskId, agentRole]);

  const handleSend = useCallback((message: string, images?: ChatImage[]) => {
    sendMessage(message, images, mode);
  }, [sendMessage, mode]);

  // Don't show the chat button if there's no plan/design content yet
  if (!hasContent) return null;

  if (!expanded) {
    return (
      <div className="mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded(true)}
        >
          Chat with {roleName}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 border rounded-lg overflow-hidden" style={{ height: '500px', display: 'flex', flexDirection: 'column' }}>
      {/* Mode toggle */}
      <div className="flex items-center gap-1 px-3 py-2 border-b bg-muted/30">
        <span className="text-xs text-muted-foreground mr-2">Mode:</span>
        {MODE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              mode === opt.value
                ? opt.value === 'changes'
                  ? 'bg-orange-500 text-white'
                  : 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
            onClick={() => setMode(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(false)}
        >
          Collapse
        </button>
      </div>

      {/* Chat area */}
      {sessionError ? (
        <div className="flex-1 flex items-center justify-center px-4">
          <InlineError message={sessionError} context="AgentChatPanel" />
        </div>
      ) : loadingSession ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Loading...
        </div>
      ) : (
        <AgentChat
          messages={messages}
          isRunning={isStreaming}
          isQueued={isQueued}
          onSend={handleSend}
          onStop={stopChat}
          tokenUsage={tokenUsage}
          emptyState={
            <p className="text-sm text-muted-foreground text-center">
              Ask questions about the {agentRole === 'designer' ? 'design' : 'plan'} or request changes.
            </p>
          }
        />
      )}
    </div>
  );
}
