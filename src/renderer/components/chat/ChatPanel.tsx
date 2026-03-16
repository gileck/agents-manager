import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PermissionMode, ChatThreadTheme } from '../../../shared/types';
import {
  Trash2,
  FileText,
  PanelRightClose,
  PanelRightOpen,
  MoreHorizontal,
  MessageSquare,
  Zap,
  ZapOff,
  Settings,
} from 'lucide-react';
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
import { ChatActionsProvider } from './ChatActionsContext';

export interface ChatPanelProps {
  scope: ChatScope;
  sessionsOverride?: ReturnType<typeof useChatSessions>;
}

export function ChatPanel({ scope, sessionsOverride }: ChatPanelProps) {
  const navigate = useNavigate();
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

  const { agents, stopAgent } = useActiveAgents();

  const {
    messages,
    isStreaming,
    isQueued,
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
  } = useChat(currentSessionId);

  const [showSidebar, setShowSidebar] = useState(false);
  const [showRawView, setShowRawView] = useState(false);
  const [showActions, setShowActions] = useState(false);

  // Reset raw view when session changes
  useEffect(() => {
    setShowRawView(false);
  }, [currentSessionId]);
  const [agentLibs, setAgentLibs] = useState<{ name: string; available: boolean }[]>([]);
  const [agentLibModels, setAgentLibModels] = useState<Record<string, { models: { value: string; label: string }[]; defaultModel: string }>>({});
  const [threadTheme, setThreadTheme] = useState<ChatThreadTheme | null>(null);

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
    window.api.settings.get().then((s) => {
      if (s.chatThreadTheme) {
        try {
          setThreadTheme(JSON.parse(s.chatThreadTheme) as ChatThreadTheme);
        } catch {
          // ignore parse errors
        }
      }
    }).catch((err) => {
      reportError(err, 'ChatPanel: load thread theme');
    });
  }, []);

  const scopeAgents = useMemo(
    () => agents.filter((a) => a.scopeType === scope.type && a.scopeId === scope.id),
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

  const selectedPermissionMode = currentSession?.permissionMode ?? null;

  const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
    if (!currentSessionId) return;
    try {
      await updateSession(currentSessionId, { permissionMode: mode });
    } catch (err) {
      reportError(err, 'ChatPanel: update permission mode');
    }
  }, [currentSessionId, updateSession]);

  const streamingEnabled = currentSession?.enableStreaming ?? true;

  const handleStreamingToggle = useCallback(async () => {
    if (!currentSessionId) return;
    try {
      await updateSession(currentSessionId, { enableStreaming: !streamingEnabled });
    } catch (err) {
      reportError(err, 'ChatPanel: update streaming');
    }
  }, [currentSessionId, updateSession, streamingEnabled]);

  const estimatedCost = (tokenUsage.inputTokens / 1_000_000) * 3.0 + (tokenUsage.outputTokens / 1_000_000) * 15.0;
  const showInlineTabs = scope.type === 'task';

  return (
    <ChatActionsProvider sendMessage={sendMessage} answerQuestion={answerQuestion} sessionId={currentSessionId} isStreaming={isStreaming}>
    <div className="flex flex-col h-full bg-transparent">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-card/40 backdrop-blur-sm">
        <div className="flex items-center gap-2 min-w-0">
          {showInlineTabs && !sessionsLoading ? (
            <SessionTabs
              sessions={sessions}
              currentSessionId={currentSessionId}
              activeAgents={scopeAgents}
              onSessionChange={switchSession}
              onSessionCreate={createSession}
              onSessionRename={renameSession}
              onSessionDelete={deleteSession}
            />
          ) : (
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight truncate text-foreground">
                {currentSession?.name || 'New thread'}
              </h2>
              <p className="text-xs text-muted-foreground">
                {scope.type === 'task' ? 'Task conversation' : 'Project conversation'}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {estimatedCost > 0 && (
            <span
              className="text-xs text-muted-foreground font-mono px-2 py-1 rounded-full border border-border/70 bg-muted/35"
              title={`Input: ${tokenUsage.inputTokens.toLocaleString()} tokens | Output: ${tokenUsage.outputTokens.toLocaleString()} tokens`}
            >
              ${estimatedCost.toFixed(4)}
            </span>
          )}

          <div className="flex items-center rounded-full border border-border/70 bg-card/65 overflow-hidden">
            <button
              onClick={() => setShowRawView(false)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${!showRawView ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}`}
              title="Chat view"
            >
              Chat
            </button>
            <button
              onClick={() => setShowRawView(true)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${showRawView ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'}`}
              title="Raw WebSocket events"
            >
              Raw
            </button>
          </div>

          <button
            onClick={handleStreamingToggle}
            className={`p-2 rounded-full border border-border/70 bg-card/65 transition-colors ${streamingEnabled ? 'text-foreground hover:bg-accent/65' : 'text-muted-foreground hover:text-foreground hover:bg-accent/65'}`}
            title={streamingEnabled ? 'Streaming on — click to disable' : 'Streaming off — click to enable'}
          >
            {streamingEnabled ? <Zap className="h-4 w-4" /> : <ZapOff className="h-4 w-4" />}
          </button>

          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="p-2 rounded-full border border-border/70 bg-card/65 text-muted-foreground hover:text-foreground hover:bg-accent/65 transition-colors"
            title="Toggle sidebar"
          >
            {showSidebar ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>

          <button
            onClick={() => navigate('/settings/threads')}
            className="p-2 rounded-full border border-border/70 bg-card/65 text-muted-foreground hover:text-foreground hover:bg-accent/65 transition-colors"
            title="Thread settings"
          >
            <Settings className="h-4 w-4" />
          </button>

          <div className="relative">
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-2 rounded-full border border-border/70 bg-card/65 text-muted-foreground hover:text-foreground hover:bg-accent/65 transition-colors"
              title="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {showActions && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowActions(false)} />
                <div className="absolute right-0 top-full mt-1.5 bg-card/95 border border-border/75 rounded-xl shadow-[0_16px_30px_hsl(var(--background)/0.45)] z-50 py-1 min-w-[170px] backdrop-blur-md">
                  <button
                    onClick={() => { summarizeChat(); setShowActions(false); }}
                    disabled={loading || isStreaming || messages.length === 0}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-accent/65 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Summarize
                  </button>
                  <button
                    onClick={() => { clearChat(); setShowActions(false); }}
                    disabled={loading || isStreaming || messages.length === 0}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-destructive hover:bg-accent/65 transition-colors disabled:opacity-40 disabled:pointer-events-none"
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
        <div
          className="flex-1 flex flex-col min-w-0"
          style={{
            ...(threadTheme?.fontSize ? { fontSize: `${threadTheme.fontSize}px` } : {}),
            ...(threadTheme?.backgroundColor ? { backgroundColor: threadTheme.backgroundColor } : {}),
          }}
        >
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
              onCancelQueue={cancelQueuedMessage}
              inputRef={inputRef}
              tokenUsage={tokenUsage}
              agentLibs={agentLibs.length > 0 && currentSessionId ? agentLibs : undefined}
              selectedAgentLib={selectedAgentLib}
              onAgentLibChange={handleAgentLibChange}
              models={currentModels.length > 0 ? currentModels : undefined}
              selectedModel={selectedModel}
              onModelChange={handleModelChange}
              permissionMode={selectedPermissionMode}
              onPermissionModeChange={handlePermissionModeChange}
              sessionId={currentSessionId}
              onPermissionResponse={respondToPermission}
              rawEvents={rawEvents}
              showRawView={showRawView}
              emptyState={(
                <div className="text-center text-muted-foreground/80 py-20">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl border border-border/70 bg-card/65 mb-5">
                    <MessageSquare className="h-7 w-7 opacity-70" />
                  </div>
                  <p className="text-4xl font-semibold tracking-tight text-foreground">
                    Let's build
                  </p>
                  <p className="text-3xl text-muted-foreground mt-1">
                    {scope.type === 'task' ? 'this task' : 'your next feature'}
                  </p>
                  <p className="text-sm mt-4 max-w-sm mx-auto">
                    Ask about code, task status, implementation details, or execution plans.
                  </p>
                </div>
              )}
            />
          )}
        </div>
        {showSidebar && (
          <div className="w-80 border-l border-border/60 bg-card/40 backdrop-blur-md flex flex-col overflow-y-auto">
            {messages.length > 0 && (
              <ContextSidebar
                messages={messages}
                tokenUsage={tokenUsage}
                perTurnUsage={perTurnUsage}
                agentLib={selectedAgentLib}
                model={selectedModel}
                modelLabel={currentModels.find((m) => m.value === selectedModel)?.label}
                systemPromptAppend={currentSession?.systemPromptAppend ?? null}
                onSystemPromptAppendChange={currentSessionId ? async (value) => {
                  try {
                    await updateSession(currentSessionId, { systemPromptAppend: value });
                  } catch (err) {
                    reportError(err, 'ChatPanel: update custom instructions');
                  }
                } : undefined}
              />
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
    </ChatActionsProvider>
  );
}
