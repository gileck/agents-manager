/**
 * Codex preset — ChatPanel.
 *
 * Top-level orchestrator matching the Codex CLI visual design:
 * - Clean top toolbar: session tabs/title, play button, agent avatar,
 *   hand-off, push/commit, icon actions
 * - Neutral dark theme (#0d0d0d) with proportional fonts
 * - No terminal elements (no chat/raw toggle, no streaming toggle,
 *   no info/gear buttons, no context percentage)
 * - Status bar is in the input area (Row 3), not a separate bottom bar
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
import { TaskStatusBar } from '../../TaskStatusBar';
import type { ChatPanelPresetProps } from '../types';

import { CodexSessionTabs } from './CodexSessionTabs';
import { CodexChatMessageList } from './CodexChatMessageList';
import { CodexChatInput } from './CodexChatInput';

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
const BG = '#141414';
const BG_HEADER = '#161616';
const BORDER = '#2a2a2a';

/** Reference counter for shared style element — prevents premature removal during concurrent mounts. */
let chatStyleRefCount = 0;

/** CSS injected once to style markdown and other inherited components in Codex context. */
const CODEX_STYLES = `
.codex-chat-root {
  font-family: ${SANS};
  color: #d1d5db;
  background-color: ${BG};
}
.codex-chat-root .codex-markdown-override {
  font-family: ${SANS};
}
.codex-chat-root .codex-markdown-override p,
.codex-chat-root .codex-markdown-override li,
.codex-chat-root .codex-markdown-override span {
  color: #d1d5db;
}
.codex-chat-root .codex-markdown-override h1,
.codex-chat-root .codex-markdown-override h2,
.codex-chat-root .codex-markdown-override h3 {
  color: #e5e7eb;
}
.codex-chat-root .codex-markdown-override strong,
.codex-chat-root .codex-markdown-override b {
  font-weight: 700;
  color: #f3f4f6;
}
.codex-chat-root .codex-markdown-override em,
.codex-chat-root .codex-markdown-override i {
  font-style: italic;
  color: #d1d5db;
}
.codex-chat-root .codex-markdown-override ul {
  list-style-type: disc;
  padding-left: 1.5rem;
}
.codex-chat-root .codex-markdown-override ol {
  list-style-type: decimal;
  padding-left: 1.5rem;
}
.codex-chat-root .codex-markdown-override li::marker {
  color: #888;
}
.codex-chat-root .codex-markdown-override code {
  background-color: #1a1a1a;
  color: #e5e7eb;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: ${MONO};
}
.codex-chat-root .codex-markdown-override pre {
  background-color: #111111;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  padding: 10px 14px;
  overflow-x: auto;
}
.codex-chat-root .codex-markdown-override pre code {
  background-color: transparent;
  padding: 0;
  font-size: 12px;
}
.codex-chat-root .codex-markdown-override a {
  color: #60a5fa;
  text-decoration: underline;
}
.codex-chat-root .codex-markdown-override blockquote {
  border-left-color: #2a2a2a;
  color: #9ca3af;
}
.codex-chat-root .codex-markdown-override hr {
  border-color: #2a2a2a;
  margin: 8px 0;
}
.codex-chat-root .codex-markdown-override table {
  border-color: #2a2a2a;
}
.codex-chat-root .codex-markdown-override th,
.codex-chat-root .codex-markdown-override td {
  border-color: #2a2a2a;
  color: #d1d5db;
}
.codex-chat-root .codex-markdown-override thead {
  background-color: #161616;
}
.codex-chat-root .codex-markdown-override .group button {
  background-color: #161616;
  border-color: #2a2a2a;
  color: #9ca3af;
}
.codex-chat-root .codex-markdown-override .group button:hover {
  background-color: #2a2a2a;
  color: #d1d5db;
}
`;

export function CodexChatPanel({ scope, sessionsOverride }: ChatPanelPresetProps) {
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
  } = useChat(currentSessionId);

  const [showSidebar, setShowSidebar] = useState(false);
  const [showActions, setShowActions] = useState(false);
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
    window.api.agentLibs.list().then(setAgentLibs).catch((err) => reportError(err, 'CodexChatPanel: load agent libs'));
    window.api.agentLibs.listModels().then(setAgentLibModels).catch((err) => reportError(err, 'CodexChatPanel: load agent models'));
    window.api.settings.get().then((s) => {
      if (s.chatThreadTheme) {
        try {
          setThreadTheme(JSON.parse(s.chatThreadTheme) as ChatThreadTheme);
        } catch {
          // ignore parse errors
        }
      }
    }).catch((err) => {
      reportError(err, 'CodexChatPanel: load thread theme');
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
    try { await updateSession(currentSessionId, { agentLib: lib || null, model: null }); }
    catch (err) { reportError(err, 'CodexChatPanel: update agent lib'); }
  }, [currentSessionId, updateSession]);

  const handleModelChange = useCallback(async (value: string) => {
    if (!currentSessionId) return;
    try {
      const engineData = agentLibModels[selectedAgentLib];
      const model = (engineData && value === engineData.defaultModel) ? null : (value || null);
      await updateSession(currentSessionId, { model });
    } catch (err) { reportError(err, 'CodexChatPanel: update model'); }
  }, [currentSessionId, updateSession, agentLibModels, selectedAgentLib]);

  const selectedPermissionMode = currentSession?.permissionMode ?? null;

  const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
    if (!currentSessionId) return;
    try { await updateSession(currentSessionId, { permissionMode: mode }); }
    catch (err) { reportError(err, 'CodexChatPanel: update permission mode'); }
  }, [currentSessionId, updateSession]);

  const handleDraftChange = useCallback(async (draft: string) => {
    if (!currentSessionId) return;
    try { await updateSession(currentSessionId, { draft: draft || null }); }
    catch (err) { reportError(err, 'CodexChatPanel: update draft'); }
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

  // Inject Codex-scoped CSS into document.head with ref counting;
  // only remove the style element when the last instance unmounts.
  useEffect(() => {
    const id = 'codex-chat-styles';
    chatStyleRefCount++;
    if (!document.getElementById(id)) {
      const style = document.createElement('style');
      style.id = id;
      style.textContent = CODEX_STYLES;
      document.head.appendChild(style);
    }
    return () => {
      chatStyleRefCount--;
      if (chatStyleRefCount <= 0) {
        document.getElementById(id)?.remove();
        chatStyleRefCount = 0;
      }
    };
  }, []);

  // Toolbar button style helper
  const toolbarBtnStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid #2a2a2a',
    color: '#888',
    cursor: 'pointer',
    fontFamily: SANS,
    fontSize: '0.8em',
    padding: '3px 8px',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    whiteSpace: 'nowrap',
  };

  return (
    <ChatActionsProvider sendMessage={sendMessage} answerQuestion={answerQuestion} sessionId={currentSessionId} isStreaming={isStreaming}>
      <div
        className="codex-chat-root"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          backgroundColor: BG,
          color: '#d1d5db',
          fontFamily: SANS,
          ...(threadTheme?.fontSize ? { fontSize: `${threadTheme.fontSize}px` } : {}),
        }}
      >
        {/* ── Codex Top Toolbar ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 16px',
          borderBottom: `1px solid ${BORDER}`,
          backgroundColor: BG_HEADER,
          minHeight: 40,
          gap: 8,
        }}>
          {/* Left: session tabs or project/session title */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {showInlineTabs && !sessionsLoading ? (
              <CodexSessionTabs
                sessions={sessions}
                currentSessionId={currentSessionId}
                activeAgents={scopeAgents}
                onSessionChange={switchSession}
                onSessionCreate={createSession}
                onSessionRename={renameSession}
                onSessionDelete={deleteSession}
              />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <span style={{
                  color: '#e5e7eb',
                  fontSize: '0.9em',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {currentSession?.name || 'New thread'}
                </span>
                <span style={{ color: '#888', fontSize: '0.8em' }}>
                  {scope.type === 'task' ? '' : scope.id ?? ''}
                </span>
              </div>
            )}
          </div>

          {/* Center: Codex toolbar actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {/* Play button */}
            <button
              type="button"
              disabled
              style={{ ...toolbarBtnStyle, opacity: 0.5, cursor: 'default' }}
              title="Run (visual-only)"
            >
              ▷
            </button>

            {/* Agent avatar */}
            <button
              type="button"
              disabled
              style={{
                ...toolbarBtnStyle,
                opacity: 0.6,
                cursor: 'default',
                borderRadius: '50%',
                width: 28,
                height: 28,
                padding: 0,
                justifyContent: 'center',
                border: 'none',
                backgroundColor: '#2a6e4e',
                color: '#fff',
                fontSize: '0.85em',
              }}
              title="Agent"
            >
              🤖
            </button>

            {/* Hand off button */}
            <button
              type="button"
              disabled
              style={{ ...toolbarBtnStyle, opacity: 0.5, cursor: 'default' }}
              title="Hand off (visual-only)"
            >
              ⇄ Hand off
            </button>

            {/* Push / Commit button */}
            <button
              type="button"
              disabled
              style={{ ...toolbarBtnStyle, opacity: 0.5, cursor: 'default' }}
              title="Push (visual-only)"
            >
              ↻ Push ∨
            </button>
          </div>

          {/* Right: icon actions + overflow */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {/* Separator */}
            <div style={{ width: 1, height: 20, backgroundColor: '#2a2a2a', margin: '0 4px' }} />

            {/* 4 icon buttons (visual-only) */}
            <button type="button" disabled style={{ ...toolbarBtnStyle, opacity: 0.4, cursor: 'default', padding: '3px 6px' }} title="Screenshot">
              📷
            </button>
            <button type="button" disabled style={{ ...toolbarBtnStyle, opacity: 0.4, cursor: 'default', padding: '3px 6px' }} title="Terminal">
              ⬛
            </button>
            <button type="button" disabled style={{ ...toolbarBtnStyle, opacity: 0.4, cursor: 'default', padding: '3px 6px' }} title="Diff view">
              ⧉
            </button>
            <button type="button" disabled style={{ ...toolbarBtnStyle, opacity: 0.4, cursor: 'default', padding: '3px 6px' }} title="Copy">
              📋
            </button>

            {/* Sidebar toggle */}
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              style={{
                ...toolbarBtnStyle,
                color: showSidebar ? '#e5e7eb' : '#888',
                backgroundColor: showSidebar ? 'rgba(255,255,255,0.06)' : 'transparent',
              }}
              title="Toggle sidebar"
            >
              ◧
            </button>

            {/* More actions */}
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowActions(!showActions)} style={toolbarBtnStyle} title="More">
                ⋯
              </button>
              {showActions && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowActions(false)} />
                  <div style={{
                    position: 'absolute', right: 0, top: '100%', marginTop: 4,
                    backgroundColor: '#1a1a1a', border: `1px solid ${BORDER}`,
                    borderRadius: 6, padding: 4, zIndex: 50, minWidth: 150,
                    fontFamily: SANS, fontSize: '0.875em',
                  }}>
                    <button
                      onClick={() => { summarizeChat(); setShowActions(false); }}
                      disabled={loading || isStreaming || messages.length === 0}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '6px 10px', background: 'transparent', border: 'none',
                        color: '#d1d5db', cursor: 'pointer', fontFamily: SANS,
                        borderRadius: 4,
                        opacity: (loading || isStreaming || messages.length === 0) ? 0.4 : 1,
                      }}
                    >
                      Summarize
                    </button>
                    <button
                      onClick={() => { clearChat(); setShowActions(false); }}
                      disabled={loading || isStreaming || messages.length === 0}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '6px 10px', background: 'transparent', border: 'none',
                        color: '#ef4444', cursor: 'pointer', fontFamily: SANS,
                        borderRadius: 4,
                        opacity: (loading || isStreaming || messages.length === 0) ? 0.4 : 1,
                      }}
                    >
                      Clear chat
                    </button>
                    <button
                      onClick={() => { navigate('/settings/threads'); setShowActions(false); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '6px 10px', background: 'transparent', border: 'none',
                        color: '#d1d5db', cursor: 'pointer', fontFamily: SANS,
                        borderRadius: 4,
                      }}
                    >
                      Settings
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Errors ── */}
        {sessionsError && (
          <div style={{ padding: '6px 16px', color: '#ef4444', fontFamily: SANS, fontSize: '0.875em', borderBottom: `1px solid ${BORDER}` }}>
            ⚠ Sessions: {sessionsError}
            <button onClick={clearSessionsError} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', marginLeft: 8, fontFamily: SANS, fontSize: '0.85em' }}>dismiss</button>
          </div>
        )}
        {error && (
          <div style={{ padding: '6px 16px', color: '#ef4444', fontFamily: SANS, fontSize: '0.875em', borderBottom: `1px solid ${BORDER}` }}>
            ⚠ Chat: {error}
            <button onClick={clearError} style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', marginLeft: 8, fontFamily: SANS, fontSize: '0.85em' }}>dismiss</button>
          </div>
        )}

        {/* ── Main content area ── */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {loading && messages.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
                <span style={{ fontFamily: SANS, fontSize: '0.9em', fontStyle: 'italic' }}>Loading messages…</span>
              </div>
            ) : messages.length === 0 && !isStreaming ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
                <div style={{ textAlign: 'center', fontFamily: SANS }}>
                  <div style={{ fontSize: '2.5em', marginBottom: 12, opacity: 0.6 }}>⬡</div>
                  <div style={{ color: '#e5e7eb', fontSize: '1.2em', fontWeight: 600 }}>
                    {scope.type === 'task' ? 'Ready to work' : 'What can I help you build?'}
                  </div>
                  <div style={{ color: '#888', fontSize: '0.9em', marginTop: 8 }}>
                    Ask about code, request changes, or explore your project.
                  </div>
                </div>
              </div>
            ) : (
              <CodexChatMessageList
                messages={messages}
                isRunning={isStreaming}
                onEditMessage={handleEditMessage}
                onResume={handleResume}
                onPermissionResponse={respondToPermission}
              />
            )}

            <TaskStatusBar sessionId={currentSessionId ?? null} />

            {/* ── Input ── */}
            <CodexChatInput
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
            />
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
                    catch (err) { reportError(err, 'CodexChatPanel: update custom instructions'); }
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
