import React, { useState } from 'react';
import { Trash2, FileText, MessageSquare } from 'lucide-react';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { useChat } from '../hooks/useChat';
import { AgentChat } from '../components/chat/AgentChat';
import { ContextSidebar } from '../components/chat/ContextSidebar';

export function ChatPage() {
  const { currentProjectId, currentProject } = useCurrentProject();
  const {
    messages,
    isStreaming,
    loading,
    error,
    sendMessage,
    stopChat,
    clearChat,
    summarizeChat,
    tokenUsage,
  } = useChat(currentProjectId);
  const [showSidebar, setShowSidebar] = useState(false);

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
          {messages.length > 0 && (
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              title="Toggle token usage sidebar"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18M7 16V8m4 8v-5m4 5V5m4 11v-3" />
              </svg>
              Tokens
            </button>
          )}
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

      {error && (
        <div className="text-center text-destructive text-sm py-2 px-6">
          Error: {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {loading && messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Loading messages...
          </div>
        ) : (
          <AgentChat
            messages={messages}
            isRunning={isStreaming}
            onSend={sendMessage}
            onStop={stopChat}
            emptyState={
              <div className="text-center text-muted-foreground py-16">
                <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Start a conversation about your project</p>
                <p className="text-xs mt-1 opacity-70">Ask about code, manage tasks, or explore the codebase</p>
              </div>
            }
          />
        )}
        {showSidebar && messages.length > 0 && (
          <ContextSidebar messages={messages} tokenUsage={tokenUsage} />
        )}
      </div>
    </div>
  );
}
