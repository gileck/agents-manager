import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TaskContextEntry, AgentChatMessage } from '../../../shared/types';
import { ChatMessageList } from '../chat/ChatMessageList';
import { MarkdownContent } from '../chat/MarkdownContent';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { reportError } from '../../lib/error-handler';

interface ReviewConversationProps {
  entries: TaskContextEntry[];
  isReviewStatus: boolean;
  streamingMessages: AgentChatMessage[];
  isStreaming: boolean;
  onSend: (message: string) => Promise<void> | void;
  onStop: () => void;
  onRequestChanges?: (comment?: string) => Promise<void> | void;
  requestingChanges?: boolean;
  hasConversation?: boolean;
  placeholder: string;
}

export function ReviewConversation({
  entries,
  isReviewStatus,
  streamingMessages,
  isStreaming,
  onSend,
  onStop,
  onRequestChanges,
  requestingChanges,
  hasConversation,
  placeholder,
}: ReviewConversationProps) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new entries or streaming
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [entries.length, streamingMessages.length]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || isStreaming || requestingChanges) return;
    setInput('');
    Promise.resolve(onSend(text)).catch((err: unknown) => {
      reportError(err instanceof Error ? err : new Error(String(err)), 'Send review message');
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Conversation history */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {entries.length === 0 && streamingMessages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            No conversation yet. Send a message to start.
          </div>
        )}

        {entries.map((entry) => {
          const isUser = entry.source === 'admin' || entry.source === 'user';
          return (
            <div key={entry.id} className={`mb-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`rounded-2xl px-4 py-2.5 max-w-[85%] shadow-sm ${
                  isUser
                    ? 'bg-primary text-primary-foreground rounded-br-md'
                    : 'bg-muted rounded-bl-md'
                }`}
              >
                {!isUser && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold">{entry.source}</span>
                    {entry.addressed && (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">addressed</span>
                    )}
                  </div>
                )}
                <div className="text-sm">
                  {isUser ? (
                    <p className="leading-relaxed">{entry.summary}</p>
                  ) : (
                    <div className="prose-sm max-w-none">
                      <MarkdownContent content={entry.summary} />
                    </div>
                  )}
                </div>
                <div className={`text-xs mt-1 flex items-center gap-2 ${isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                  <span>{new Date(entry.createdAt).toLocaleString()}</span>
                  {!isUser && entry.agentRunId && (
                    <button
                      className="underline hover:no-underline text-xs"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'inherit' }}
                      onClick={() => navigate(`/agents/${entry.agentRunId}`)}
                    >
                      View Run
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Streaming agent response */}
        {streamingMessages.length > 0 && (
          <div className="mb-3">
            <ChatMessageList messages={streamingMessages} isRunning={isStreaming} />
          </div>
        )}

        {/* Streaming indicator when no messages yet */}
        {isStreaming && streamingMessages.length === 0 && (
          <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
            <div className="flex gap-1">
              <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-pulse" />
              <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
              <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
            </div>
            <span className="text-xs">Thinking...</span>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input area */}
      {isReviewStatus && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', flexShrink: 0 }}>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={2}
            className="mb-2 resize-none"
            disabled={isStreaming || requestingChanges}
          />
          <div className="flex justify-between">
            <div>
              {onRequestChanges && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const text = input.trim();
                    setInput('');
                    Promise.resolve(onRequestChanges(text || undefined)).catch((err: unknown) => {
                      reportError(err instanceof Error ? err : new Error(String(err)), 'Request changes');
                    });
                  }}
                  disabled={(!hasConversation && !input.trim()) || isStreaming || requestingChanges}
                >
                  {requestingChanges ? 'Submitting...' : 'Request Changes'}
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              {isStreaming && (
                <Button variant="outline" size="sm" onClick={onStop}>
                  Stop
                </Button>
              )}
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!input.trim() || isStreaming || requestingChanges}
              >
                Send
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
