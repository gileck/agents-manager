import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Trash2, FileText, MessageSquare, PanelRightClose, PanelRightOpen, Cpu } from 'lucide-react';
import { InlineError } from '../InlineError';
import { reportError } from '../../lib/error-handler';
import { useChat } from '../../hooks/useChat';
import { useChatSessions, ChatScope } from '../../hooks/useChatSessions';
import { useActiveAgents } from '../../hooks/useActiveAgents';
import { AgentChat } from './AgentChat';
import { ContextSidebar } from './ContextSidebar';
import { SessionTabs } from './SessionTabs';
import { ActiveAgentsPanel } from './ActiveAgentsPanel';

export interface ChatPanelProps {
  scope: ChatScope;
  sessionsOverride?: ReturnType<typeof useChatSessions>;
}

export function ChatPanel({ scope, sessionsOverride }: ChatPanelProps) {
  const localSessions = useChatSessions(sessionsOverride ? null : scope);
  const {
    sessions,
    currentSessionId,
    currentSession,
    createSession,
    renameSession,
    updateSession,
    deleteSession,
    switchSession,
    loading: sessionsLoading,
    error: sessionsError,
    clearError: clearSessionsError,
  } = sessionsOverride ?? localSessions;

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
    clearError,
    sendMessage,
    stopChat,
    clearChat,
    summarizeChat,
    tokenUsage,
  } = useChat(currentSessionId);

  const [showSidebar, setShowSidebar] = useState(false);
  const [agentLibs, setAgentLibs] = useState<{ name: string; available: boolean }[]>([]);

  // Load available agent libs once
  useEffect(() => {
    window.api.agentLibs.list().then(setAgentLibs).catch((err) => {
      reportError(err, 'ChatPanel: load agent libs');
    });
  }, []);

  // Filter agents to current scope only
  const scopeAgents = useMemo(
    () => agents.filter(a => a.scopeType === scope.type && a.scopeId === scope.id),
    [agents, scope.type, scope.id],
  );

  const handleAgentLibChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!currentSessionId) return;
    try {
      await updateSession(currentSessionId, { agentLib: e.target.value || null });
    } catch (err) {
      reportError(err, 'ChatPanel: update agent lib');
    }
  }, [currentSessionId, updateSession]);

  const selectedAgentLib = currentSession?.agentLib || 'claude-code';

  const estimatedCost = (tokenUsage.inputTokens / 1_000_000) * 3.0 + (tokenUsage.outputTokens / 1_000_000) * 15.0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Chat</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* Agent lib selector */}
          {agentLibs.length > 0 && currentSessionId && (
            <div className="flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={selectedAgentLib}
                onChange={handleAgentLibChange}
                disabled={isStreaming}
                className="text-xs font-medium rounded-md bg-muted text-muted-foreground border-0 px-2 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none transition-colors focus:outline-none focus:ring-1 focus:ring-ring"
                title="Select agent engine"
              >
                {agentLibs.map(lib => (
                  <option key={lib.name} value={lib.name} disabled={!lib.available}>
                    {lib.name}{!lib.available ? ' (unavailable)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* Compact token cost display */}
          {estimatedCost > 0 && (
            <span
              className="text-xs text-muted-foreground font-mono px-1"
              title={`Input: ${tokenUsage.inputTokens.toLocaleString()} tokens | Output: ${tokenUsage.outputTokens.toLocaleString()} tokens`}
            >
              ${estimatedCost.toFixed(4)}
            </span>
          )}
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
      {!sessionsLoading && (
        <SessionTabs
          sessions={sessions}
          currentSessionId={currentSessionId}
          activeAgents={scopeAgents}
          onSessionChange={switchSession}
          onSessionCreate={createSession}
          onSessionRename={renameSession}
          onSessionDelete={deleteSession}
        />
      )}

      {sessionsError && (
        <div className="py-2 px-6">
          <InlineError message={sessionsError} context="Sessions" onDismiss={clearSessionsError} />
        </div>
      )}

      {error && (
        <div className="py-2 px-6">
          <InlineError message={error} context="Chat" onDismiss={clearError} />
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
              tokenUsage={tokenUsage}
              emptyState={
                <div className="text-center text-muted-foreground py-16">
                  <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">
                    {scope.type === 'task'
                      ? 'Ask questions about this task'
                      : 'Start a conversation about your project'}
                  </p>
                  <p className="text-xs mt-1 opacity-70">
                    {scope.type === 'task'
                      ? 'The assistant can read files and manage this task via the CLI'
                      : 'Ask about code, manage tasks, or explore the codebase'}
                  </p>
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
            {scopeAgents.length > 0 && (
              <ActiveAgentsPanel
                agents={scopeAgents}
                onNavigateToSession={switchSession}
                onStopAgent={stopAgent}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
