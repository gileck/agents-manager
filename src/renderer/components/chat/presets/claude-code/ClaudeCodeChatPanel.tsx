/**
 * Claude Code preset — ChatPanel.
 *
 * Top-level orchestrator that replicates ChatPanel.tsx logic but renders
 * a terminal-style dark UI: dark background wrapper, terminal header with
 * PresetSelector and action buttons, message list area, bottom status bar
 * (model name, token usage), and terminal-style input.
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PermissionMode, AgentChatMessageUser, ChatThreadTheme } from '../../../../../shared/types';
import { reportError } from '../../../../lib/error-handler';
import { useChat } from '../../../../hooks/useChat';
import { useChatSessions } from '../../../../hooks/useChatSessions';
import { useChatKeyboardShortcuts } from '../../../../hooks/useChatKeyboardShortcuts';
import { useActiveAgents } from '../../../../hooks/useActiveAgents';
import { ContextSidebar } from '../../ContextSidebar';
import { ActiveAgentsPanel } from '../../ActiveAgentsPanel';
import { ChatActionsProvider } from '../../ChatActionsContext';
import { RawChatView } from '../../RawChatView';
import { TaskStatusBar } from '../../TaskStatusBar';
import type { ChatPanelPresetProps } from '../types';

import { ClaudeCodeSessionTabs } from './ClaudeCodeSessionTabs';
import { ClaudeCodeChatMessageList } from './ClaudeCodeChatMessageList';
import { ClaudeCodeChatInput } from './ClaudeCodeChatInput';

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
const BG = '#0d1117';
const BG_HEADER = '#161b22';
const BORDER = '#1e293b';

/** CSS injected once to style markdown and other inherited components in terminal context. */
const TERMINAL_STYLES = `
.cc-terminal-root {
  font-family: ${MONO};
  color: #d1d5db;
  background-color: ${BG};
}
.cc-terminal-root .cc-markdown-override p,
.cc-terminal-root .cc-markdown-override li,
.cc-terminal-root .cc-markdown-override span {
  color: #d1d5db;
}
.cc-terminal-root .cc-markdown-override h1,
.cc-terminal-root .cc-markdown-override h2,
.cc-terminal-root .cc-markdown-override h3 {
  color: #e5e7eb;
}
.cc-terminal-root .cc-markdown-override strong,
.cc-terminal-root .cc-markdown-override b {
  font-weight: 700;
  color: #f3f4f6;
}
.cc-terminal-root .cc-markdown-override em,
.cc-terminal-root .cc-markdown-override i {
  font-style: italic;
  color: #d1d5db;
}
.cc-terminal-root .cc-markdown-override ul {
  list-style-type: disc;
  padding-left: 1.5rem;
}
.cc-terminal-root .cc-markdown-override ol {
  list-style-type: decimal;
  padding-left: 1.5rem;
}
.cc-terminal-root .cc-markdown-override li::marker {
  color: #6b7280;
}
.cc-terminal-root .cc-markdown-override code {
  background-color: #1e293b;
  color: #e5e7eb;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.923em;
  font-family: ${MONO};
}
.cc-terminal-root .cc-markdown-override pre {
  background-color: #111827;
  border: 1px solid #1e293b;
  border-radius: 4px;
  padding: 8px 12px;
  overflow-x: auto;
}
.cc-terminal-root .cc-markdown-override pre code {
  background-color: transparent;
  padding: 0;
  font-size: 12px;
}
.cc-terminal-root .cc-markdown-override a {
  color: #60a5fa;
  text-decoration: underline;
}
.cc-terminal-root .cc-markdown-override blockquote {
  border-left-color: #374151;
  color: #9ca3af;
}
.cc-terminal-root .cc-markdown-override hr {
  border-color: #374151;
  margin: 8px 0;
}
.cc-terminal-root .cc-markdown-override table {
  border-color: #374151;
}
.cc-terminal-root .cc-markdown-override th,
.cc-terminal-root .cc-markdown-override td {
  border-color: #374151;
  color: #d1d5db;
}
.cc-terminal-root .cc-markdown-override thead {
  background-color: #1e293b;
}
.cc-terminal-root .cc-markdown-override .group button {
  background-color: #1e293b;
  border-color: #374151;
  color: #9ca3af;
}
.cc-terminal-root .cc-markdown-override .group button:hover {
  background-color: #374151;
  color: #d1d5db;
}
`;

export function ClaudeCodeChatPanel({ scope, sessionsOverride }: ChatPanelPresetProps) {
  // TODO: extract shared orchestration hook (e.g. useChatPanelOrchestration(scope, sessionsOverride))
  // to avoid drift with ChatPanel.tsx. The ~200 lines of hooks/state/callbacks below are
  // duplicated from the default ChatPanel orchestrator.
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

  const handleSwitchSession = useCallback((sessionId: string) => {
    switchSession(sessionId);
    navigate(`/chat/${sessionId}`);
  }, [switchSession, navigate]);

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
  } = useChat(currentSessionId, { enableStreamingInput: (currentSession?.enableStreamingInput ?? false) });

  const [showSidebar, setShowSidebar] = useState(false);
  const [showRawView, setShowRawView] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [agentLibs, setAgentLibs] = useState<{ name: string; available: boolean }[]>([]);
  const [agentLibModels, setAgentLibModels] = useState<Record<string, { models: { value: string; label: string }[]; defaultModel: string }>>({});
  const [agentLibFeatures, setAgentLibFeatures] = useState<Record<string, { streamingInput: boolean }>>({});
  const [threadTheme, setThreadTheme] = useState<ChatThreadTheme | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset raw view on session change
  useEffect(() => { setShowRawView(false); }, [currentSessionId]);

  useChatKeyboardShortcuts({
    clearChat,
    focusInput: () => inputRef.current?.focus(),
  });

  useEffect(() => {
    window.api.agentLibs.list().then(setAgentLibs).catch((err) => reportError(err, 'ClaudeCodeChatPanel: load agent libs'));
    window.api.agentLibs.listModels().then(setAgentLibModels).catch((err) => reportError(err, 'ClaudeCodeChatPanel: load agent models'));
    window.api.agentLibs.listFeatures().then(setAgentLibFeatures).catch((err) => reportError(err, 'ClaudeCodeChatPanel: load agent features'));
    window.api.settings.get().then((s) => {
      if (s.chatThreadTheme) {
        try {
          setThreadTheme(JSON.parse(s.chatThreadTheme) as ChatThreadTheme);
        } catch {
          // ignore parse errors
        }
      }
    }).catch((err) => {
      reportError(err, 'ClaudeCodeChatPanel: load thread theme');
    });
  }, []);

  const scopeAgents = useMemo(
    () => agents.filter((a) => a.scopeType === scope.type && a.scopeId === scope.id),
    [agents, scope.type, scope.id],
  );

  const isWaitingForInput = useMemo(
    () => agents.some((a) => a.sessionId === currentSessionId && a.status === 'waiting_for_input'),
    [agents, currentSessionId],
  );

  const selectedAgentLib = currentSession?.agentLib || 'claude-code';
  const currentModels = agentLibModels[selectedAgentLib]?.models ?? [];
  const defaultModel = agentLibModels[selectedAgentLib]?.defaultModel ?? '';
  const selectedModel = currentSession?.model || defaultModel;

  const handleAgentLibChange = useCallback(async (lib: string) => {
    if (!currentSessionId) return;
    try { await updateSession(currentSessionId, { agentLib: lib || null, model: null }); }
    catch (err) { reportError(err, 'ClaudeCodeChatPanel: update agent lib'); }
  }, [currentSessionId, updateSession]);

  const handleModelChange = useCallback(async (value: string) => {
    if (!currentSessionId) return;
    try {
      const engineData = agentLibModels[selectedAgentLib];
      const model = (engineData && value === engineData.defaultModel) ? null : (value || null);
      await updateSession(currentSessionId, { model });
    } catch (err) { reportError(err, 'ClaudeCodeChatPanel: update model'); }
  }, [currentSessionId, updateSession, agentLibModels, selectedAgentLib]);

  const selectedPermissionMode = currentSession?.permissionMode ?? null;

  const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
    if (!currentSessionId) return;
    try { await updateSession(currentSessionId, { permissionMode: mode }); }
    catch (err) { reportError(err, 'ClaudeCodeChatPanel: update permission mode'); }
  }, [currentSessionId, updateSession]);

  const streamingEnabled = currentSession?.enableStreaming ?? true;

  const handleStreamingToggle = useCallback(async () => {
    if (!currentSessionId) return;
    try { await updateSession(currentSessionId, { enableStreaming: !streamingEnabled }); }
    catch (err) { reportError(err, 'ClaudeCodeChatPanel: update streaming'); }
  }, [currentSessionId, updateSession, streamingEnabled]);

  const streamingInputEnabled = currentSession?.enableStreamingInput ?? false;
  const libSupportsStreamingInput = agentLibFeatures[selectedAgentLib]?.streamingInput ?? false;

  const handleStreamingInputToggle = useCallback(async () => {
    if (!currentSessionId) return;
    try { await updateSession(currentSessionId, { enableStreamingInput: !streamingInputEnabled }); }
    catch (err) { reportError(err, 'ClaudeCodeChatPanel: update streaming input'); }
  }, [currentSessionId, updateSession, streamingInputEnabled]);

  const handleDraftChange = useCallback(async (draft: string) => {
    if (!currentSessionId) return;
    try { await updateSession(currentSessionId, { draft: draft || null }); }
    catch (err) { reportError(err, 'ClaudeCodeChatPanel: update draft'); }
  }, [currentSessionId, updateSession]);

  // ── AgentChat-level state for prefill / edit ──
  const [prefill, setPrefill] = useState<{ text: string; seq: number } | null>(null);
  const handleEditMessage = useCallback((text: string) => {
    setPrefill((prev) => ({ text, seq: (prev?.seq ?? 0) + 1 }));
  }, []);
  const handleResume = useCallback((text: string) => { sendMessage(text); }, [sendMessage]);

  useEffect(() => {
    if (!isStreaming || !stopChat) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') stopChat(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isStreaming, stopChat]);

  const lastUserMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.type === 'user') return (m as AgentChatMessageUser).text;
    }
    return undefined;
  }, [messages]);

  const handleEditLastMessage = useCallback(() => {
    if (lastUserMessage) handleEditMessage(lastUserMessage);
  }, [lastUserMessage, handleEditMessage]);

  const showInlineTabs = scope.type === 'task';

  // Inject terminal-scoped CSS once into document.head; clean up on unmount.
  useEffect(() => {
    const id = 'cc-terminal-styles';
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = TERMINAL_STYLES;
      document.head.appendChild(style);
    }
    return () => {
      document.getElementById(id)?.remove();
    };
  }, []);

  // Button style helper
  const btnStyle = (active?: boolean): React.CSSProperties => ({
    background: active ? '#1e293b' : 'transparent',
    border: '1px solid #374151',
    color: active ? '#e5e7eb' : '#6b7280',
    cursor: 'pointer',
    fontFamily: MONO,
    fontSize: '0.846em',
    padding: '3px 10px',
    borderRadius: 4,
    whiteSpace: 'nowrap',
  });

  return (
    <ChatActionsProvider sendMessage={sendMessage} answerQuestion={answerQuestion} sessionId={currentSessionId} isStreaming={isStreaming}>
      <div
        className="cc-terminal-root"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          backgroundColor: BG,
          color: '#d1d5db',
          fontFamily: MONO,
          ...(threadTheme?.fontSize ? { fontSize: `${threadTheme.fontSize}px` } : {}),
        }}
      >
        {/* ── Terminal Header ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          borderBottom: `1px solid ${BORDER}`,
          backgroundColor: BG_HEADER,
          minHeight: 44,
          gap: 8,
        }}>
          {/* Left: session tabs or title */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {showInlineTabs && !sessionsLoading ? (
              <ClaudeCodeSessionTabs
                sessions={sessions}
                currentSessionId={currentSessionId}
                activeAgents={scopeAgents}
                onSessionChange={handleSwitchSession}
                onSessionCreate={createSession}
                onSessionRename={renameSession}
                onSessionDelete={deleteSession}
              />
            ) : (
              <span style={{ color: '#e5e7eb', fontSize: '1em', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentSession?.name || 'New thread'}
              </span>
            )}
          </div>

          {/* Right: actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {/* Chat / Raw toggle */}
            <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${BORDER}` }}>
              <button onClick={() => setShowRawView(false)} style={btnStyle(!showRawView)} title="Chat view">
                chat
              </button>
              <button onClick={() => setShowRawView(true)} style={btnStyle(showRawView)} title="Raw events">
                raw
              </button>
            </div>

            {/* Streaming toggle */}
            <button
              onClick={handleStreamingToggle}
              style={btnStyle(streamingEnabled)}
              title={streamingEnabled ? 'Streaming on' : 'Streaming off'}
            >
              {streamingEnabled ? '⚡ on' : '⚡ off'}
            </button>

            {/* Streaming input (live injection) toggle */}
            {libSupportsStreamingInput && (
              <button
                onClick={handleStreamingInputToggle}
                style={btnStyle(streamingInputEnabled)}
                title={streamingInputEnabled ? 'Live injection on — messages injected mid-execution' : 'Live injection off — messages queued'}
              >
                {streamingInputEnabled ? '💬 inject' : '💬 queue'}
              </button>
            )}

            {/* Sidebar toggle */}
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              style={btnStyle(showSidebar)}
              title="Toggle sidebar"
            >
              {showSidebar ? '◧ hide' : '◧ info'}
            </button>

            {/* Settings */}
            <button onClick={() => navigate('/settings/threads')} style={btnStyle()} title="Thread settings">
              ⚙
            </button>

            {/* More actions */}
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowActions(!showActions)} style={btnStyle()} title="More">
                ⋯
              </button>
              {showActions && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowActions(false)} />
                  <div style={{
                    position: 'absolute', right: 0, top: '100%', marginTop: 4,
                    backgroundColor: '#1f2937', border: `1px solid ${BORDER}`,
                    borderRadius: 6, padding: 4, zIndex: 50, minWidth: 150,
                    fontFamily: MONO, fontSize: '0.923em',
                  }}>
                    <button
                      onClick={() => { summarizeChat(); setShowActions(false); }}
                      disabled={loading || isStreaming || messages.length === 0}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '4px 8px', background: 'transparent', border: 'none',
                        color: '#d1d5db', cursor: 'pointer', opacity: (loading || isStreaming || messages.length === 0) ? 0.4 : 1,
                      }}
                    >
                      📋 summarize
                    </button>
                    <button
                      onClick={() => { clearChat(); setShowActions(false); }}
                      disabled={loading || isStreaming || messages.length === 0}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '4px 8px', background: 'transparent', border: 'none',
                        color: '#ef4444', cursor: 'pointer', opacity: (loading || isStreaming || messages.length === 0) ? 0.4 : 1,
                      }}
                    >
                      🗑 clear
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Errors ── */}
        {sessionsError && (
          <div style={{ padding: '6px 16px', color: '#ef4444', fontFamily: MONO, fontSize: '0.923em', borderBottom: `1px solid ${BORDER}` }}>
            ⚠ Sessions: {sessionsError}
            <button onClick={clearSessionsError} style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', marginLeft: 8, fontFamily: MONO, fontSize: '0.846em' }}>dismiss</button>
          </div>
        )}
        {error && (
          <div style={{ padding: '6px 16px', color: '#ef4444', fontFamily: MONO, fontSize: '0.923em', borderBottom: `1px solid ${BORDER}` }}>
            ⚠ Chat: {error}
            <button onClick={clearError} style={{ background: 'transparent', border: 'none', color: '#6b7280', cursor: 'pointer', marginLeft: 8, fontFamily: MONO, fontSize: '0.846em' }}>dismiss</button>
          </div>
        )}

        {/* ── Main content area ── */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {loading && messages.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
                <span style={{ fontFamily: MONO, fontSize: '0.923em', fontStyle: 'italic' }}>⠿ loading messages…</span>
              </div>
            ) : showRawView ? (
              <RawChatView rawEvents={rawEvents} />
            ) : messages.length === 0 && !isStreaming ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
                <div style={{ textAlign: 'center', fontFamily: MONO }}>
                  <div style={{ fontSize: '2.46em', marginBottom: 12 }}>❯</div>
                  <div style={{ color: '#e5e7eb', fontSize: '1.23em', fontWeight: 600 }}>
                    {scope.type === 'task' ? 'Ready to work' : 'What shall we build?'}
                  </div>
                  <div style={{ color: '#6b7280', fontSize: '0.923em', marginTop: 8 }}>
                    Ask about code, implementation details, or execution plans.
                  </div>
                </div>
              </div>
            ) : (
              <ClaudeCodeChatMessageList
                messages={messages}
                isRunning={isStreaming}
                onEditMessage={handleEditMessage}
                onResume={handleResume}
                onPermissionResponse={respondToPermission}
              />
            )}

            {!showRawView && <TaskStatusBar sessionId={currentSessionId ?? null} />}

            {/* ── Input ── */}
            {!showRawView && (
              <ClaudeCodeChatInput
                ref={inputRef}
                key={currentSessionId ?? ''}
                onSend={sendMessage}
                onStop={stopChat}
                isRunning={isStreaming}
                isQueued={isQueued}
                onCancelQueue={cancelQueuedMessage}
                tokenUsage={tokenUsage}
                agentLibs={agentLibs.length > 0 && currentSessionId ? agentLibs : undefined}
                selectedAgentLib={selectedAgentLib}
                onAgentLibChange={handleAgentLibChange}
                models={currentModels.length > 0 ? currentModels : undefined}
                selectedModel={selectedModel}
                onModelChange={handleModelChange}
                permissionMode={selectedPermissionMode}
                onPermissionModeChange={handlePermissionModeChange}
                prefill={prefill}
                lastUserMessage={lastUserMessage}
                onEditLastMessage={handleEditLastMessage}
                initialDraft={currentSession?.draft ?? null}
                onDraftChange={handleDraftChange}
                enableStreamingInput={streamingInputEnabled && libSupportsStreamingInput}
                isWaitingForInput={isWaitingForInput}
              />
            )}
          </div>

          {/* ── Sidebar ── */}
          {showSidebar && (
            <div style={{
              width: 320,
              borderLeft: `1px solid ${BORDER}`,
              backgroundColor: BG_HEADER,
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
            }}>
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
                    try { await updateSession(currentSessionId, { systemPromptAppend: value }); }
                    catch (err) { reportError(err, 'ClaudeCodeChatPanel: update custom instructions'); }
                  } : undefined}
                />
              )}
              {scopeAgents.length > 0 && (
                <ActiveAgentsPanel
                  agents={scopeAgents}
                  onNavigateToSession={handleSwitchSession}
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
