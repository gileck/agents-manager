/**
 * Codex preset — ChatMessageList.
 *
 * Chat-app style message timeline matching the Codex CLI aesthetic:
 * - User messages: right-aligned dark pill bubbles (#2a2a3e)
 * - Assistant text: left-aligned, proportional font, no bullet prefix
 * - Collapsible "N previous messages" with centered HR-style dividers
 * - Scroll-to-bottom: centered ↓ arrow in circle
 * - Tool calls: clean collapsible sections (not terminal-style)
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  AgentChatMessage,
  AgentChatMessageToolUse,
  AgentChatMessageToolResult,
  AgentChatMessageUser,
  AgentChatMessageStatus,
  AgentChatMessageAskUserQuestion,
  AgentChatMessagePermissionRequest,
  AgentChatMessagePermissionResponse,
  AgentChatMessageNotification,
  AgentChatMessageSubagentActivity,
  AgentChatMessageSlashCommand,
  ChatImageRef,
} from '../../../../../shared/types';
import { MarkdownContent } from '../../MarkdownContent';
import { AgentRunInfoCard } from '../../AgentRunInfoCard';
import { AskUserQuestionCard } from '../../AskUserQuestionCard';
import { useChatActions } from '../../ChatActionsContext';
import { ImageAnnotationPanel } from '../../../ui/ImageAnnotationPanel';
import type { AnnotationImage } from '../../../ui/ImageAnnotationPanel';
import { groupMessages } from '../../utils/group-messages';
import type { ChatMessageListPresetProps } from '../types';
import { CodexAgentBlock } from './CodexAgentBlock';

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
const ACCENT = '#f59e0b';

/** Strip <thinking>…</thinking> XML blocks from assistant text before rendering. */
function stripThinkingBlocks(text: string): string {
  return text.replace(/<thinking[^>]*>[\s\S]*?<\/thinking>/g, '').trim();
}

/** Real-time elapsed time display. */
function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const elapsed = Math.floor((now - startedAt) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span style={{ color: '#888', fontSize: '0.85em', fontFamily: SANS }}>
      {m > 0 ? `${m}m ${s}s` : `${s}s`}
    </span>
  );
}

/** Collapsed system notification with expand toggle. */
function CollapsedSystemNotification({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = text.length > 80 ? text.slice(0, 80).trimEnd() + '…' : text;

  return (
    <div style={{ margin: '2px 0', fontFamily: SANS, fontSize: '0.875em' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '2px 0', width: '100%', textAlign: 'left',
        }}
      >
        <span style={{ color: '#60a5fa', flexShrink: 0 }}>ⓘ</span>
        <span style={{ color: '#60a5fa', fontWeight: 600, flexShrink: 0, fontFamily: SANS }}>System Notification</span>
        {!expanded && (
          <span style={{ color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {summary}
          </span>
        )}
        <span style={{ color: '#888', flexShrink: 0, marginLeft: 'auto' }}>{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div style={{ paddingLeft: 16, color: '#9ca3af', whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingTop: 2, fontFamily: SANS }}>
          {text}
        </div>
      )}
    </div>
  );
}

/** Clean collapsible tool call rendering (non-terminal style). */
function CodexToolCall({
  toolUse,
  toolResult,
  expanded,
  onToggle,
}: {
  toolUse: AgentChatMessageToolUse;
  toolResult?: AgentChatMessageToolResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ padding: '2px 0' }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 0',
          fontFamily: SANS,
          fontSize: '0.875em',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span style={{
          color: '#888',
          fontSize: '0.7em',
          transition: 'transform 0.15s',
          transform: expanded ? 'rotate(90deg)' : 'none',
        }}>▶</span>
        <span style={{ color: '#d1d5db' }}>{toolUse.toolName}</span>
        {toolResult && <span style={{ color: '#888', fontSize: '0.85em' }}>✓</span>}
      </button>
      {expanded && (
        <div style={{ marginLeft: 20, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Input */}
          <div style={{
            padding: '6px 10px',
            backgroundColor: '#1a1a28',
            borderRadius: 6,
            maxHeight: 200,
            overflowY: 'auto',
          }}>
            <pre style={{
              color: '#9ca3af',
              fontSize: '0.8em',
              fontFamily: MONO,
              whiteSpace: 'pre-wrap',
              margin: 0,
            }}>
              {typeof toolUse.input === 'string'
                ? (toolUse.input.length > 2000 ? toolUse.input.slice(0, 2000) + '\n…' : toolUse.input)
                : JSON.stringify(toolUse.input, null, 2).slice(0, 2000)}
            </pre>
          </div>
          {/* Result */}
          {toolResult && (
            <div style={{
              padding: '6px 10px',
              backgroundColor: '#1a1a28',
              borderRadius: 6,
              maxHeight: 200,
              overflowY: 'auto',
            }}>
              <pre style={{
                color: '#9ca3af',
                fontSize: '0.8em',
                fontFamily: MONO,
                whiteSpace: 'pre-wrap',
                margin: 0,
              }}>
                {toolResult.result.length > 2000 ? toolResult.result.slice(0, 2000) + '\n…' : toolResult.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Codex-style collapsible message group ("N previous messages") with centered HR dividers. */
function CodexCollapsibleGroup({
  messages,
  startIndex,
  expandedTools,
  onToggleTool,
}: {
  messages: AgentChatMessage[];
  startIndex: number;
  expandedTools: Set<number>;
  onToggleTool: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Build result map for tool results
  const resultMap = useMemo(() => {
    const map = new Map<string, AgentChatMessageToolResult>();
    for (const msg of messages) {
      if (msg.type === 'tool_result' && msg.toolId) {
        map.set(msg.toolId, msg as AgentChatMessageToolResult);
      }
    }
    return map;
  }, [messages]);

  const count = messages.length;

  return (
    <div style={{ margin: '12px 0' }}>
      {/* Centered HR-style divider with text */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          width: '100%',
          padding: '4px 0',
          fontFamily: SANS,
        }}
      >
        <div style={{ flex: 1, height: 1, backgroundColor: '#333' }} />
        <span style={{ color: '#888', fontSize: '0.8em', whiteSpace: 'nowrap' }}>
          {count} previous message{count !== 1 ? 's' : ''} {expanded ? '▾' : '▸'}
        </span>
        <div style={{ flex: 1, height: 1, backgroundColor: '#333' }} />
      </button>
      {expanded && (
        <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid #2a2a3e' }}>
          {messages.map((msg, i) => {
            const globalIndex = startIndex + i;
            if (msg.type === 'tool_use') {
              const toolUse = msg as AgentChatMessageToolUse;
              const toolResult = toolUse.toolId ? resultMap.get(toolUse.toolId) : undefined;
              return (
                <CodexToolCall
                  key={i}
                  toolUse={toolUse}
                  toolResult={toolResult}
                  expanded={expandedTools.has(globalIndex)}
                  onToggle={() => onToggleTool(globalIndex)}
                />
              );
            }
            if (msg.type === 'thinking') {
              return (
                <div key={i} style={{ color: '#888', fontSize: '0.85em', fontStyle: 'italic', padding: '2px 0', fontFamily: SANS }}>
                  {msg.text.length > 500 ? msg.text.slice(0, 500) + '…' : msg.text}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

export function CodexChatMessageList({
  messages,
  isRunning,
  onEditMessage,
  onResume,
  onPermissionResponse,
}: ChatMessageListPresetProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { answerQuestion } = useChatActions();
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const [viewerImages, setViewerImages] = useState<AnnotationImage[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  // Elapsed time tracking
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const prevIsRunning = useRef(false);
  useEffect(() => {
    if (isRunning && !prevIsRunning.current) setStartedAt(Date.now());
    else if (!isRunning && prevIsRunning.current) setStartedAt(null);
    prevIsRunning.current = !!isRunning;
  }, [isRunning]);

  const toggleTool = useCallback((index: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleScroll = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    setAutoScroll(c.scrollHeight - c.scrollTop - c.clientHeight < 80);
  }, []);

  useEffect(() => {
    if (!autoScroll) return;
    endRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages.length, autoScroll]);

  const scrollToLatest = useCallback(() => {
    setAutoScroll(true);
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const segments = useMemo(() => groupMessages(messages), [messages]);

  const rendered = useMemo(() => {
    const resultMap = new Map<string, AgentChatMessageToolResult>();
    for (const msg of messages) {
      if (msg.type === 'tool_result' && msg.toolId) {
        resultMap.set(msg.toolId, msg as AgentChatMessageToolResult);
      }
    }
    const matchedResultIds = new Set<string>();
    const nodes: React.ReactNode[] = [];

    for (const segment of segments) {
      if (segment.type === 'agent') {
        nodes.push(
          <CodexAgentBlock
            key={`agent-${segment.startIndex}`}
            segment={segment}
            expandedTools={expandedTools}
            onToggleTool={toggleTool}
            sessionRunning={isRunning}
          />,
        );
        continue;
      }

      if (segment.type === 'group') {
        nodes.push(
          <CodexCollapsibleGroup
            key={`group-${segment.startIndex}`}
            messages={segment.messages}
            startIndex={segment.startIndex}
            expandedTools={expandedTools}
            onToggleTool={toggleTool}
          />,
        );
        continue;
      }

      const { msg, index: i } = segment;

      // ── User message (right-aligned dark pill bubble) ──
      if (msg.type === 'user') {
        const userMsg = msg as AgentChatMessageUser;
        nodes.push(
          <div key={i} style={{
            display: 'flex',
            justifyContent: 'flex-end',
            padding: '8px 0',
          }}>
            <div style={{
              maxWidth: '80%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 4,
            }}>
              <div style={{
                backgroundColor: '#2a2a3e',
                borderRadius: '18px 18px 4px 18px',
                padding: '10px 16px',
                color: '#e5e7eb',
                fontFamily: SANS,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: '22px',
                fontSize: '0.95em',
              }}>
                {userMsg.text}
              </div>
              {userMsg.images && userMsg.images.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {userMsg.images.map((img: ChatImageRef, j: number) => (
                    <img
                      key={j}
                      src={`/api/chat/images?path=${encodeURIComponent(img.path)}`}
                      alt={img.name || 'Image'}
                      style={{ maxHeight: 120, maxWidth: 180, borderRadius: 8, border: '1px solid #3a3a4e', cursor: 'pointer' }}
                      onClick={() => {
                        const imgs = userMsg.images!.map((im: ChatImageRef) => ({ src: `/api/chat/images?path=${encodeURIComponent(im.path)}`, name: im.name }));
                        setViewerImages(imgs);
                        setViewerIndex(j);
                      }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ))}
                </div>
              )}
              {onEditMessage && (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => onEditMessage(userMsg.text)}
                  style={{
                    background: 'transparent', border: 'none', color: '#888',
                    cursor: isRunning ? 'not-allowed' : 'pointer', fontSize: '0.75em',
                    fontFamily: SANS, opacity: 0.5,
                  }}
                  title="Edit & resend"
                >
                  ✎ edit
                </button>
              )}
            </div>
          </div>,
        );
      }

      // ── Assistant text (left-aligned, no bubble, proportional font) ──
      else if (msg.type === 'assistant_text') {
        nodes.push(
          <div key={i} style={{
            padding: '6px 0',
            lineHeight: '24px',
            fontFamily: SANS,
          }}>
            <div style={{ color: '#d1d5db' }} className="codex-markdown-override">
              <MarkdownContent content={stripThinkingBlocks(msg.text)} />
            </div>
          </div>,
        );
      }

      // ── Tool use (top-level — clean collapsible) ──
      else if (msg.type === 'tool_use') {
        const toolUse = msg as AgentChatMessageToolUse;
        const toolResult = toolUse.toolId ? resultMap.get(toolUse.toolId) : undefined;
        if (toolResult?.toolId) matchedResultIds.add(toolResult.toolId);
        nodes.push(
          <CodexToolCall
            key={i}
            toolUse={toolUse}
            toolResult={toolResult}
            expanded={expandedTools.has(i)}
            onToggle={() => toggleTool(i)}
          />,
        );
      }

      // ── Tool result (orphan) ──
      else if (msg.type === 'tool_result') {
        const result = msg as AgentChatMessageToolResult;
        if (result.toolId && matchedResultIds.has(result.toolId)) continue;
        nodes.push(
          <div key={i} style={{ padding: '2px 0 2px 20px' }}>
            <pre style={{
              color: '#9ca3af', fontSize: '0.8em', fontFamily: MONO,
              whiteSpace: 'pre-wrap', margin: 0, display: 'inline',
            }}>
              {result.result.length > 2000 ? result.result.slice(0, 2000) + '\n…' : result.result}
            </pre>
          </div>,
        );
      }

      // ── Thinking (orphan) ──
      else if (msg.type === 'thinking') {
        nodes.push(
          <div key={i} style={{ color: '#888', fontSize: '0.85em', fontStyle: 'italic', padding: '2px 0', paddingLeft: 16, fontFamily: SANS }}>
            {msg.text.length > 300 ? msg.text.slice(0, 300) + '…' : msg.text}
          </div>,
        );
      }

      // ── Status ──
      else if (msg.type === 'status') {
        const statusMsg = msg as AgentChatMessageStatus;
        const isStopped = statusMsg.status === 'cancelled';
        const isError = statusMsg.status === 'failed' || statusMsg.status === 'timed_out';

        if (isStopped || isError) {
          const lastUserMsg = [...messages].reverse().find((m): m is AgentChatMessageUser => m.type === 'user');
          const lastUserText = lastUserMsg?.text ?? null;
          const label = isStopped ? 'Stopped' : statusMsg.status === 'timed_out' ? 'Timed out' : 'Error';

          nodes.push(
            <div key={i} style={{ padding: '8px 0', textAlign: 'center' }}>
              <span style={{
                color: isError ? '#ef4444' : '#888',
                fontFamily: SANS,
                fontSize: '0.875em',
                padding: '4px 14px',
                border: `1px solid ${isError ? '#7f1d1d' : '#3a3a4e'}`,
                borderRadius: 8,
                display: 'inline-block',
              }}>
                {label}{statusMsg.message ? `: ${statusMsg.message}` : ''}
              </span>
              {!isRunning && (
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 8 }}>
                  {onResume && (
                    <button
                      type="button"
                      onClick={() => onResume(lastUserText ?? 'continue')}
                      style={{
                        background: 'transparent', border: `1px solid ${ACCENT}`,
                        color: ACCENT, cursor: 'pointer', fontFamily: SANS,
                        fontSize: '0.8em', padding: '4px 12px', borderRadius: 6,
                      }}
                    >
                      ▶ {lastUserText ? 'Continue' : 'Retry'}
                    </button>
                  )}
                  {onEditMessage && lastUserText && (
                    <button
                      type="button"
                      onClick={() => onEditMessage(lastUserText)}
                      style={{
                        background: 'transparent', border: '1px solid #3a3a4e',
                        color: '#d1d5db', cursor: 'pointer', fontFamily: SANS,
                        fontSize: '0.8em', padding: '4px 12px', borderRadius: 6,
                      }}
                    >
                      ✎ Edit & retry
                    </button>
                  )}
                </div>
              )}
            </div>,
          );
        } else {
          nodes.push(
            <div key={i} style={{ padding: '4px 0', textAlign: 'center' }}>
              <span style={{ color: '#888', fontFamily: SANS, fontSize: '0.8em' }}>
                — {statusMsg.message} —
              </span>
            </div>,
          );
        }
      }

      // ── Agent run info ──
      else if (msg.type === 'agent_run_info') {
        nodes.push(
          <div key={i} style={{ padding: '4px 0' }}>
            {msg.agentRunId ? (
              <AgentRunInfoCard agentRunId={msg.agentRunId} taskId={msg.taskId} agentType={msg.agentType} />
            ) : (
              <span style={{ fontFamily: SANS, fontSize: '0.85em', color: '#888', padding: '2px 10px' }}>
                Agent Run (no details available)
              </span>
            )}
          </div>,
        );
      }

      // ── Compact boundary ──
      else if (msg.type === 'compact_boundary') {
        nodes.push(
          <div key={i} style={{ padding: '8px 0', textAlign: 'center' }}>
            <span style={{
              color: ACCENT, fontFamily: SANS, fontSize: '0.8em',
              border: `1px solid rgba(245,158,11,0.3)`, padding: '4px 14px', borderRadius: 8,
            }}>
              ✂ Context compacted · {msg.trigger} · {msg.preTokens.toLocaleString()} tokens before
            </span>
          </div>,
        );
      }

      // ── Ask user question ──
      else if (msg.type === 'ask_user_question') {
        nodes.push(
          <AskUserQuestionCard key={i} message={msg as AgentChatMessageAskUserQuestion} onAnswer={answerQuestion} />,
        );
      }

      // ── Compacting ──
      else if (msg.type === 'compacting' && msg.active) {
        const hasLater = messages.slice(i + 1).some((m) => m.type === 'compacting');
        if (!hasLater) {
          nodes.push(
            <div key={i} style={{ padding: '6px 0', textAlign: 'center' }}>
              <span style={{ color: ACCENT, fontFamily: SANS, fontSize: '0.8em', fontStyle: 'italic' }}>
                ⠿ Compacting context…
              </span>
            </div>,
          );
        }
      }

      // ── Permission request ──
      else if (msg.type === 'permission_request') {
        const permReq = msg as AgentChatMessagePermissionRequest;
        const responseMsg = messages.find(
          (m) => m.type === 'permission_response' && (m as AgentChatMessagePermissionResponse).requestId === permReq.requestId,
        ) as AgentChatMessagePermissionResponse | undefined;

        nodes.push(
          <div key={i} style={{
            margin: '6px 0', padding: '10px 14px',
            border: `1px solid ${ACCENT}`, borderRadius: 8,
            backgroundColor: 'rgba(245,158,11,0.05)',
          }}>
            <div style={{ color: ACCENT, fontSize: '0.875em', fontFamily: SANS, fontWeight: 600, marginBottom: 4 }}>
              🛡 Permission Request: {permReq.toolName}
            </div>
            <pre style={{
              color: '#9ca3af', fontSize: '0.8em', fontFamily: MONO, whiteSpace: 'pre-wrap',
              maxHeight: 100, overflowY: 'auto', margin: 0, padding: '6px 10px',
              backgroundColor: '#1a1a28', borderRadius: 6,
            }}>
              {typeof permReq.toolInput === 'string'
                ? permReq.toolInput
                : JSON.stringify(permReq.toolInput, null, 2).slice(0, 2000)}
            </pre>
            {responseMsg ? (
              <div style={{ marginTop: 6, color: responseMsg.allowed ? '#888' : '#ef4444', fontSize: '0.8em', fontFamily: SANS }}>
                {responseMsg.allowed ? '✓ Allowed' : '✗ Denied'}
              </div>
            ) : (
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => onPermissionResponse?.(permReq.requestId, true)}
                  style={{
                    background: 'transparent', border: `1px solid ${ACCENT}`,
                    color: ACCENT, cursor: 'pointer', fontFamily: SANS,
                    fontSize: '0.8em', padding: '4px 12px', borderRadius: 6,
                  }}
                >
                  ✓ Allow
                </button>
                <button
                  type="button"
                  onClick={() => onPermissionResponse?.(permReq.requestId, false)}
                  style={{
                    background: 'transparent', border: '1px solid #ef4444',
                    color: '#ef4444', cursor: 'pointer', fontFamily: SANS,
                    fontSize: '0.8em', padding: '4px 12px', borderRadius: 6,
                  }}
                >
                  ✗ Deny
                </button>
              </div>
            )}
          </div>,
        );
      }

      // ── Permission response (standalone — skip, handled inline above) ──
      else if (msg.type === 'permission_response') {
        // skip
      }

      // ── Notification ──
      else if (msg.type === 'notification') {
        const notif = msg as AgentChatMessageNotification;
        const isSystemNotification = notif.body?.startsWith('[System Notification]');

        if (isSystemNotification) {
          const displayText = notif.body.replace(/^\[System Notification\]\s*/, '');
          nodes.push(
            <CollapsedSystemNotification key={i} text={displayText} />,
          );
        } else {
          nodes.push(
            <div key={i} style={{ padding: '4px 0', color: '#60a5fa', fontFamily: SANS, fontSize: '0.875em' }}>
              <span style={{ marginRight: 6 }}>🔔</span>
              {notif.title && <span style={{ fontWeight: 600 }}>{notif.title}: </span>}
              <span>{notif.body}</span>
            </div>,
          );
        }
      }

      // ── Subagent activity ──
      else if (msg.type === 'subagent_activity') {
        const act = msg as AgentChatMessageSubagentActivity;
        const started = act.status === 'started';
        nodes.push(
          <div key={i} style={{ padding: '2px 0', fontFamily: SANS, fontSize: '0.875em' }}>
            <span style={{ color: started ? '#8b5cf6' : '#888', marginRight: 6 }}>
              {started ? '▶' : '✓'}
            </span>
            <span style={{ color: started ? '#8b5cf6' : '#888', fontWeight: 600 }}>{act.agentName}</span>
            <span style={{ color: '#888' }}> {started ? 'started' : 'completed'}</span>
          </div>,
        );
      }

      // ── Slash command ──
      else if (msg.type === 'slash_command') {
        const cmd = msg as AgentChatMessageSlashCommand;
        nodes.push(
          <div key={i} style={{ padding: '2px 0', fontFamily: SANS, fontSize: '0.875em' }}>
            <span style={{ color: '#60a5fa', marginRight: 4, fontFamily: MONO }}>$</span>
            <span style={{ color: '#60a5fa', fontWeight: 600 }}>{cmd.command}</span>
            {cmd.args && <span style={{ color: '#9ca3af' }}> {cmd.args}</span>}
            <span style={{ color: '#888', marginLeft: 8, fontSize: '0.85em' }}>
              {cmd.status === 'completed' ? '✓' : '…'}
            </span>
          </div>,
        );
      }
    }

    return nodes;
  }, [segments, messages, expandedTools, toggleTool, onEditMessage, onResume, onPermissionResponse, isRunning, navigate, answerQuestion]);

  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <div
        ref={containerRef}
        style={{ height: '100%', overflowY: 'auto' }}
        onScroll={handleScroll}
      >
        <div style={{ padding: '16px 16px 8px', fontFamily: SANS, fontSize: '1em' }}>
          {rendered.length === 0 && isRunning && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 8 }}>
              <span style={{ color: '#888', fontSize: '0.9em', fontStyle: 'italic' }}>Working…</span>
              {startedAt && <ElapsedTime startedAt={startedAt} />}
            </div>
          )}
          {rendered}
          {isRunning && rendered.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ color: ACCENT, fontSize: '0.85em', animation: 'pulse 1.5s infinite' }}>●</span>
              <span style={{ color: '#888', fontSize: '0.9em', fontStyle: 'italic' }}>Thinking…</span>
              {startedAt && <ElapsedTime startedAt={startedAt} />}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Scroll-to-bottom: centered ↓ in circle */}
      {!autoScroll && (
        <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
          <button
            type="button"
            onClick={scrollToLatest}
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: '#2a2a3e',
              color: '#d1d5db',
              border: '1px solid #3a3a4e',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.1em',
              lineHeight: 1,
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
            title="Scroll to latest"
          >
            ↓
          </button>
        </div>
      )}

      {viewerImages && (
        <ImageAnnotationPanel
          images={viewerImages}
          initialIndex={viewerIndex}
          onClose={() => setViewerImages(null)}
          readOnly
        />
      )}
    </div>
  );
}
