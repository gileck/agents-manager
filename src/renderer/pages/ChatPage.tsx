import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Trash2, FileText, MessageSquare } from 'lucide-react';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { useChat } from '../hooks/useChat';
import type { ChatMessage } from '../../shared/types';

export function ChatPage() {
  const { currentProjectId, currentProject } = useCurrentProject();
  const {
    messages,
    streamingContent,
    isStreaming,
    loading,
    error,
    sendMessage,
    stopChat,
    clearChat,
    summarizeChat,
  } = useChat(currentProjectId);

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages or streaming content arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!currentProjectId) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <div className="text-center">
          <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">Select a project to start chatting</p>
          <p className="text-sm mt-1">Choose a project from the sidebar to begin</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Chat</h1>
          {currentProject && (
            <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded-full">
              {currentProject.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={summarizeChat}
            disabled={loading || isStreaming || messages.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors"
            title="Summarize conversation"
          >
            <FileText className="h-3.5 w-3.5" />
            Summarize
          </button>
          <button
            onClick={clearChat}
            disabled={loading || isStreaming || messages.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors"
            title="Clear conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {loading && messages.length === 0 && (
          <div className="text-center text-muted-foreground py-8">Loading messages...</div>
        )}

        {!loading && messages.length === 0 && !isStreaming && (
          <div className="text-center text-muted-foreground py-16">
            <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">Start a conversation about your project</p>
            <p className="text-xs mt-1 opacity-70">Ask about code, manage tasks, or explore the codebase</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming response */}
        {isStreaming && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-3 bg-card border border-border text-card-foreground">
              <div className="text-xs font-medium text-muted-foreground mb-1">Assistant</div>
              <div className="text-sm whitespace-pre-wrap break-words">{streamingContent}</div>
              <span className="inline-block w-2 h-4 ml-0.5 bg-primary animate-pulse rounded-sm" />
            </div>
          </div>
        )}

        {isStreaming && !streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-3 bg-card border border-border">
              <div className="text-xs font-medium text-muted-foreground mb-1">Assistant</div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                Thinking...
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="text-center text-destructive text-sm py-2">
            Error: {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-border bg-card px-6 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send a message... (Shift+Enter for new line)"
            rows={1}
            disabled={isStreaming}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              onClick={stopChat}
              className="flex items-center justify-center h-10 w-10 rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
              title="Stop"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none transition-colors"
              title="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : isSystem
            ? 'bg-muted border border-border text-muted-foreground'
            : 'bg-card border border-border text-card-foreground'
        }`}
      >
        {!isUser && (
          <div className="text-xs font-medium mb-1 opacity-70">
            {isSystem ? 'System Summary' : 'Assistant'}
          </div>
        )}
        <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  );
}
