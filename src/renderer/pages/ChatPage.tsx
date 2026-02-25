import React, { useState, useCallback } from 'react';
import { Trash2, FileText, MessageSquare, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { useChat } from '../hooks/useChat';
import { useChatSessions } from '../hooks/useChatSessions';
import { useActiveAgents } from '../hooks/useActiveAgents';
import { AgentChat } from '../components/chat/AgentChat';
import { ContextSidebar } from '../components/chat/ContextSidebar';
import { SessionTabs } from '../components/chat/SessionTabs';
import { ActiveAgentsPanel } from '../components/chat/ActiveAgentsPanel';
import { useNavigate } from 'react-router-dom';

export function ChatPage() {
  const { currentProjectId, currentProject } = useCurrentProject();
  const navigate = useNavigate();
  const {
    sessions,
    currentSessionId,
    createSession,
    renameSession,
    deleteSession,
    switchSession,
    loading: sessionsLoading,
  } = useChatSessions(currentProjectId);

  const {
    agents,
    stopAgent,
  } = useActiveAgents();

  const {
    messages,
    isStreaming,
    isQueued,
    loading,
    error,
    sendMessage,
    stopChat,
    clearChat,
    summarizeChat,
    tokenUsage,
  } = useChat(currentSessionId);
  const [showSidebar, setShowSidebar] = useState(false);

  const handleNavigateToSession = useCallback((sessionId: string) => {
    const agent = agents.find(a => a.sessionId === sessionId);
    if (agent) {
      // Navigate to the project if different
      if (agent.projectId !== currentProjectId) {
        navigate(`/projects/${agent.projectId}/chat`);
      }
      // Switch to the session
      switchSession(sessionId);
    }
  }, [agents, currentProjectId, navigate, switchSession]);

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
            onClick={() => setShowSidebar(!showSidebar)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            title="Toggle sidebar"
          >
            {showSidebar ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            Sidebar
          </button>
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

      {/* Session tabs */}
      {currentProjectId && !sessionsLoading && (
        <SessionTabs
          sessions={sessions}
          currentSessionId={currentSessionId}
          activeAgents={agents}
          onSessionChange={switchSession}
          onSessionCreate={createSession}
          onSessionRename={renameSession}
          onSessionDelete={deleteSession}
        />
      )}

      {error && (
        <div className="text-center text-destructive text-sm py-2 px-6">
          Error: {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          {loading && messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Loading messages...
            </div>
          ) : (
            <AgentChat
              messages={messages}
              isRunning={isStreaming}
              isQueued={isQueued}
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
        </div>
        {showSidebar && (
          <div className="w-72 border-l border-border bg-card flex flex-col overflow-y-auto">
            {/* Token Usage section */}
            {messages.length > 0 && (
              <ContextSidebar messages={messages} tokenUsage={tokenUsage} />
            )}
            {/* Active Agents section */}
            {agents.length > 0 && (
              <ActiveAgentsPanel
                agents={agents}
                onNavigateToSession={handleNavigateToSession}
                onStopAgent={stopAgent}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
