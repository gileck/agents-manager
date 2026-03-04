import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Trash2, FileText, PanelRightClose, PanelRightOpen, MoreHorizontal, MessageSquare } from 'lucide-react';
import { InlineError } from '../InlineError';
import { reportError } from '../../lib/error-handler';
import { useChat } from '../../hooks/useChat';
import { useChatSessions, ChatScope } from '../../hooks/useChatSessions';
import { useChatKeyboardShortcuts } from '../../hooks/useChatKeyboardShortcuts';
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
  const [showActions, setShowActions] = useState(false);
  const [agentLibs, setAgentLibs] = useState<{ name: string; available: boolean }[]>([]);
  const [agentLibModels, setAgentLibModels] = useState<Record<string, { models: { value: string; label: string }[]; defaultModel: string }>>({});

  const inputRef = useRef<HTMLTextAreaElement>(null);

  useChatKeyboardShortcuts({
    sessions,
    currentSessionId,
    switchSession,
    createSession,
    deleteSession,
    clearChat,
    focusInput: () => inputRef.current?.focus(),
  });

  useEffect(() => {
    window.api.agentLibs.list().then(setAgentLibs).catch((err) => {
      reportError(err, 'ChatPanel: load agent libs');
    });
    window.api.agentLibs.listModels().then(setAgentLibModels).catch((err) => {
      reportError(err, 'ChatPanel: load agent models');
    });
  }, []);

  const scopeAgents = useMemo(
    () => agents.filter(a => a.scopeType === scope.type && a.scopeId === scope.id),
    [agents, scope.type, scope.id],
  );

  const selectedAgentLib = currentSession?.agentLib || 'claude-code';
  const currentModels = agentLibModels[selectedAgentLib]?.models ?? [];
  const defaultModel = agentLibModels[selectedAgentLib]?.defaultModel ?? '';
  const selectedModel = currentSession?.model || defaultModel;

  const handleAgentLibChange = useCallback(async (lib: string) => {
    if (!currentSessionId) return;
    try {
      await updateSession(currentSessionId, { agentLib: lib || null, model: null });
    } catch (err) {
      reportError(err, 'ChatPanel: update agent lib');
    }
  }, [currentSessionId, updateSession]);

  const handleModelChange = useCallback(async (value: string) => {
    if (!currentSessionId) return;
    try {
      const engineData = agentLibModels[selectedAgentLib];
      const model = (engineData && value === engineData.defaultModel) ? null : (value || null);
      await updateSession(currentSessionId, { model });
    } catch (err) {
      reportError(err, 'ChatPanel: update model');
    }
  }, [currentSessionId, updateSession, agentLibModels, selectedAgentLib]);

  const estimatedCost = (tokenUsage.inputTokens / 1_000_000) * 3.0 + (tokenUsage.outputTokens / 1_000_000) * 15.0;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Minimal header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50">
        <div className="flex items-center gap-2 min-w-0">
          {/* Session tabs inline */}
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
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {estimatedCost > 0 && (
            <span
              className="text-xs text-muted-foreground font-mono px-2 py-1"
              title={`Input: ${tokenUsage.inputTokens.toLocaleString()} tokens | Output: ${tokenUsage.outputTokens.toLocaleString()} tokens`}
            >
              ${estimatedCost.toFixed(4)}
            </span>
          )}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="Toggle sidebar"
          >
            {showSidebar ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              title="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {showActions && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowActions(false)} />
                <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-50 py-1 min-w-[160px]">
                  <button
                    onClick={() => { summarizeChat(); setShowActions(false); }}
                    disabled={loading || isStreaming || messages.length === 0}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Summarize
                  </button>
                  <button
                    onClick={() => { clearChat(); setShowActions(false); }}
                    disabled={loading || isStreaming || messages.length === 0}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-destructive hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear conversation
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {sessionsError && (
        <div className="py-2 px-4">
          <InlineError message={sessionsError} context="Sessions" onDismiss={clearSessionsError} />
        </div>
      )}

      {error && (
        <div className="py-2 px-4">
          <InlineError message={error} context="Chat" onDismiss={clearError} />
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          {loading && messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <div className="w-5 h-5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                <span className="text-sm">Loading messages...</span>
              </div>
            </div>
          ) : (
            <AgentChat
              messages={messages}
              isRunning={isStreaming}
              isQueued={isQueued}
              onSend={sendMessage}
              onStop={stopChat}
              inputRef={inputRef}
              tokenUsage={tokenUsage}
              agentLibs={agentLibs.length > 0 && currentSessionId ? agentLibs : undefined}
              selectedAgentLib={selectedAgentLib}
              onAgentLibChange={handleAgentLibChange}
              models={currentModels.length > 0 ? currentModels : undefined}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
              emptyState={
                <div className="text-center text-muted-foreground/80 py-20">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-muted/50 mb-4">
                    <MessageSquare className="h-7 w-7 opacity-50" />
                  </div>
                  <p className="text-base font-medium text-foreground/70">
                    {scope.type === 'task'
                      ? 'Ask questions about this task'
                      : 'Start a conversation about your project'}
                  </p>
                  <p className="text-sm mt-2 max-w-xs mx-auto">
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
          <div className="w-72 border-l border-border/50 bg-card/50 flex flex-col overflow-y-auto">
            {messages.length > 0 && (
              <ContextSidebar messages={messages} tokenUsage={tokenUsage} agentLib={selectedAgentLib} model={selectedModel} modelLabel={currentModels.find(m => m.value === selectedModel)?.label} />
            )}
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
