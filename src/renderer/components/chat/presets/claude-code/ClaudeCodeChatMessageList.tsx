/**
 * Claude Code preset — ChatMessageList.
 *
 * Terminal-style message timeline rendering all segment types:
 * - User messages: white text with muted gray ❯ prefix
 * - Assistant text: white ● + MarkdownContent
 * - Tool calls: colored ● + bold name + collapsible └ results
 * - Thinking groups: ✻ Crunched for Xs
 * - Status, errors, permissions, agent_run_info, etc.
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
import { getTerminalToolRenderer } from './tool-renderers';
import { AgentRunInfoCard } from '../../AgentRunInfoCard';
import { AskUserQuestionCard } from '../../AskUserQuestionCard';
import { useChatActions } from '../../ChatActionsContext';
import { ImageAnnotationPanel } from '../../../ui/ImageAnnotationPanel';
import type { AnnotationImage } from '../../../ui/ImageAnnotationPanel';
import { groupMessages } from '../../utils/group-messages';
import type { ChatMessageListPresetProps } from '../types';
import { ClaudeCodeAgentBlock } from './ClaudeCodeAgentBlock';

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

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
    <span style={{ color: '#6b7280', fontSize: '0.923em', fontFamily: MONO }}>
      {m > 0 ? `${m}m ${s}s` : `${s}s`}
    </span>
  );
}

/** Collapsed system notification with expand toggle. */
function CollapsedSystemNotification({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = text.length > 80 ? text.slice(0, 80).trimEnd() + '…' : text;

  return (
    <div style={{ margin: '2px 0', fontFamily: MONO, fontSize: '0.923em' }}>
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
        <span style={{ color: '#60a5fa', fontWeight: 600, flexShrink: 0, fontFamily: MONO }}>System Notification</span>
        {!expanded && (
          <span style={{ color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {summary}
          </span>
        )}
        <span style={{ color: '#6b7280', flexShrink: 0, marginLeft: 'auto' }}>{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div style={{ paddingLeft: 16, color: '#9ca3af', whiteSpace: 'pre-wrap', wordBreak: 'break-word', paddingTop: 2, fontFamily: MONO }}>
          {text}
        </div>
      )}
    </div>
  );
}

/** Terminal-style ThinkingGroup summary. */
function TerminalThinkingGroup({
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

  const { durationS, toolNames, totalTokens } = useMemo(() => {
    const first = messages[0];
    const last = messages[messages.length - 1];
    const durationMs = last.timestamp - first.timestamp;
    const durationSec = (durationMs / 1000).toFixed(1);
    const seenTools = new Set<string>();
    const names: string[] = [];
    let tokens = 0;
    for (const msg of messages) {
      if (msg.type === 'tool_use' && !seenTools.has(msg.toolName)) {
        seenTools.add(msg.toolName);
        names.push(msg.toolName);
      } else if (msg.type === 'usage') {
        tokens += msg.inputTokens + msg.outputTokens;
      }
    }
    return { durationS: durationSec, toolNames: names, totalTokens: tokens };
  }, [messages]);

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

  const toolsSummary = toolNames.length > 0
    ? toolNames.slice(0, 3).join(', ') + (toolNames.length > 3 ? ` +${toolNames.length - 3}` : '')
    : null;

  return (
    <div style={{ margin: '4px 0' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: '#6b7280', fontFamily: MONO, fontSize: '0.923em', padding: '2px 0',
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        <span style={{ color: '#8b5cf6' }}>✻</span>
        <span style={{ fontStyle: 'italic' }}>Crunched for {durationS}s</span>
        {toolsSummary && (
          <>
            <span style={{ color: '#374151' }}>·</span>
            <span>{toolsSummary}</span>
          </>
        )}
        {totalTokens > 0 && (
          <>
            <span style={{ color: '#374151' }}>·</span>
            <span>{totalTokens.toLocaleString()} tokens</span>
          </>
        )}
        <span>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div style={{ marginLeft: 16, paddingLeft: 8, borderLeft: '1px solid #1e293b' }}>
          {messages.map((msg, i) => {
            const globalIndex = startIndex + i;
            if (msg.type === 'thinking') {
              return (
                <div key={i} style={{ color: '#6b7280', fontSize: '0.923em', fontStyle: 'italic', padding: '2px 0' }}>
                  {msg.text.length > 500 ? msg.text.slice(0, 500) + '\u2026' : msg.text}
                </div>
              );
            }
            if (msg.type === 'tool_use') {
              const toolUse = msg as AgentChatMessageToolUse;
              const toolResult = toolUse.toolId ? resultMap.get(toolUse.toolId) : undefined;
              const Renderer = getTerminalToolRenderer(toolUse.toolName);
              return (
                <Renderer
                  key={i}
                  toolUse={toolUse}
                  toolResult={toolResult}
                  expanded={expandedTools.has(globalIndex)}
                  onToggle={() => onToggleTool(globalIndex)}
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}

export function ClaudeCodeChatMessageList({
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
          <ClaudeCodeAgentBlock
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
          <TerminalThinkingGroup
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

      // ── User message ──
      if (msg.type === 'user') {
        const userMsg = msg as AgentChatMessageUser;
        nodes.push(
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', lineHeight: '22px', backgroundColor: '#161b22', marginLeft: -16, marginRight: -16, paddingLeft: 16, paddingRight: 16 }}>
            <span style={{ color: '#6b7280', fontWeight: 700, fontSize: '1.077em', flexShrink: 0, userSelect: 'none' }}>❯</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ color: '#e5e7eb', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{userMsg.text}</span>
              {userMsg.images && userMsg.images.length > 0 && (
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {userMsg.images.map((img: ChatImageRef, j: number) => (
                    <img
                      key={j}
                      src={`/api/chat/images?path=${encodeURIComponent(img.path)}`}
                      alt={img.name || 'Image'}
                      style={{ maxHeight: 160, maxWidth: 240, borderRadius: 4, border: '1px solid #374151', cursor: 'pointer' }}
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
            </div>
            {onEditMessage && (
              <button
                type="button"
                disabled={isRunning}
                onClick={() => onEditMessage(userMsg.text)}
                style={{
                  background: 'transparent', border: 'none', color: '#6b7280',
                  cursor: isRunning ? 'not-allowed' : 'pointer', fontSize: '0.846em',
                  fontFamily: MONO, opacity: 0.5, flexShrink: 0,
                }}
                title="Edit & resend"
              >
                ✎
              </button>
            )}
          </div>,
        );
      }

      // ── Assistant text ──
      else if (msg.type === 'assistant_text') {
        nodes.push(
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', lineHeight: '22px' }}>
            <span style={{ color: '#d1d5db', fontSize: '0.77em', flexShrink: 0, userSelect: 'none', marginTop: 2 }}>●</span>
            <div style={{ flex: 1, minWidth: 0, color: '#d1d5db' }} className="cc-markdown-override">
              <MarkdownContent content={stripThinkingBlocks(msg.text)} />
            </div>
          </div>,
        );
      }

      // ── Tool use (top-level) ──
      else if (msg.type === 'tool_use') {
        const toolUse = msg as AgentChatMessageToolUse;
        const toolResult = toolUse.toolId ? resultMap.get(toolUse.toolId) : undefined;
        if (toolResult?.toolId) matchedResultIds.add(toolResult.toolId);
        const Renderer = getTerminalToolRenderer(toolUse.toolName);
        nodes.push(
          <div key={i} style={{ padding: '2px 0' }}>
            <Renderer
              toolUse={toolUse}
              toolResult={toolResult}
              expanded={expandedTools.has(i)}
              onToggle={() => toggleTool(i)}
            />
          </div>,
        );
      }

      // ── Tool result (orphan) ──
      else if (msg.type === 'tool_result') {
        const result = msg as AgentChatMessageToolResult;
        if (result.toolId && matchedResultIds.has(result.toolId)) continue;
        nodes.push(
          <div key={i} style={{ padding: '2px 0 2px 20px' }}>
            <span style={{ color: '#6b7280', fontSize: '0.923em' }}>└ </span>
            <pre style={{ color: '#9ca3af', fontSize: '0.846em', fontFamily: MONO, whiteSpace: 'pre-wrap', margin: 0, display: 'inline' }}>
              {result.result.length > 2000 ? result.result.slice(0, 2000) + '\n\u2026' : result.result}
            </pre>
          </div>,
        );
      }

      // ── Thinking (orphan) ──
      else if (msg.type === 'thinking') {
        nodes.push(
          <div key={i} style={{ color: '#6b7280', fontSize: '0.923em', fontStyle: 'italic', padding: '2px 0', paddingLeft: 16 }}>
            {msg.text.length > 300 ? msg.text.slice(0, 300) + '\u2026' : msg.text}
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
          const label = isStopped ? 'stopped' : statusMsg.status === 'timed_out' ? 'timed out' : 'error';

          nodes.push(
            <div key={i} style={{ padding: '8px 0', textAlign: 'center' }}>
              <span style={{
                color: isError ? '#ef4444' : '#6b7280',
                fontFamily: MONO, fontSize: '0.923em',
                padding: '2px 12px',
                border: `1px solid ${isError ? '#7f1d1d' : '#374151'}`,
                borderRadius: 4,
              }}>
                ■ {label}{statusMsg.message ? `: ${statusMsg.message}` : ''}
              </span>
              {!isRunning && (
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 8 }}>
                  {onResume && (
                    <button
                      type="button"
                      onClick={() => onResume(lastUserText ?? 'continue')}
                      style={{
                        background: 'transparent', border: '1px solid #374151',
                        color: '#22c55e', cursor: 'pointer', fontFamily: MONO,
                        fontSize: '0.846em', padding: '2px 10px', borderRadius: 4,
                      }}
                    >
                      ▶ {lastUserText ? 'continue' : 'retry'}
                    </button>
                  )}
                  {onEditMessage && lastUserText && (
                    <button
                      type="button"
                      onClick={() => onEditMessage(lastUserText)}
                      style={{
                        background: 'transparent', border: '1px solid #374151',
                        color: '#d1d5db', cursor: 'pointer', fontFamily: MONO,
                        fontSize: '0.846em', padding: '2px 10px', borderRadius: 4,
                      }}
                    >
                      ✎ edit & retry
                    </button>
                  )}
                </div>
              )}
            </div>,
          );
        } else {
          nodes.push(
            <div key={i} style={{ padding: '4px 0', textAlign: 'center' }}>
              <span style={{ color: '#6b7280', fontFamily: MONO, fontSize: '0.846em' }}>
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
              <button
                onClick={() => navigate(`/agents/${msg.agentRunId}`)}
                style={{
                  background: 'transparent', border: '1px solid #374151',
                  color: '#6b7280', cursor: 'pointer', fontFamily: MONO,
                  fontSize: '0.846em', padding: '2px 10px', borderRadius: 4,
                }}
              >
                Agent Run → View details
              </button>
            )}
          </div>,
        );
      }

      // ── Compact boundary ──
      else if (msg.type === 'compact_boundary') {
        nodes.push(
          <div key={i} style={{ padding: '6px 0', textAlign: 'center' }}>
            <span style={{ color: '#f59e0b', fontFamily: MONO, fontSize: '0.846em', border: '1px solid rgba(245,158,11,0.3)', padding: '2px 12px', borderRadius: 4 }}>
              ✂ context compacted · {msg.trigger} · {msg.preTokens.toLocaleString()} tokens before
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
              <span style={{ color: '#f59e0b', fontFamily: MONO, fontSize: '0.846em', fontStyle: 'italic' }}>
                ⠿ compacting context…
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
            margin: '6px 0', padding: '8px 12px',
            border: '1px solid #f59e0b', borderRadius: 4,
            backgroundColor: 'rgba(245,158,11,0.05)',
          }}>
            <div style={{ color: '#f59e0b', fontSize: '0.923em', fontFamily: MONO, fontWeight: 600, marginBottom: 4 }}>
              🛡 Permission Request: {permReq.toolName}
            </div>
            <pre style={{
              color: '#9ca3af', fontSize: '0.846em', fontFamily: MONO, whiteSpace: 'pre-wrap',
              maxHeight: 100, overflowY: 'auto', margin: 0, padding: '4px 8px',
              backgroundColor: '#111827', borderRadius: 4,
            }}>
              {typeof permReq.toolInput === 'string'
                ? permReq.toolInput
                : JSON.stringify(permReq.toolInput, null, 2).slice(0, 2000)}
            </pre>
            {responseMsg ? (
              <div style={{ marginTop: 6, color: responseMsg.allowed ? '#22c55e' : '#ef4444', fontSize: '0.846em', fontFamily: MONO }}>
                {responseMsg.allowed ? '✓ allowed' : '✗ denied'}
              </div>
            ) : (
              <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => onPermissionResponse?.(permReq.requestId, true)}
                  style={{
                    background: 'transparent', border: '1px solid #22c55e',
                    color: '#22c55e', cursor: 'pointer', fontFamily: MONO,
                    fontSize: '0.846em', padding: '2px 10px', borderRadius: 4,
                  }}
                >
                  ✓ allow
                </button>
                <button
                  type="button"
                  onClick={() => onPermissionResponse?.(permReq.requestId, false)}
                  style={{
                    background: 'transparent', border: '1px solid #ef4444',
                    color: '#ef4444', cursor: 'pointer', fontFamily: MONO,
                    fontSize: '0.846em', padding: '2px 10px', borderRadius: 4,
                  }}
                >
                  ✗ deny
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
            <div key={i} style={{ padding: '4px 0', color: '#60a5fa', fontFamily: MONO, fontSize: '0.923em' }}>
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
          <div key={i} style={{ padding: '2px 0', fontFamily: MONO, fontSize: '0.923em' }}>
            <span style={{ color: started ? '#8b5cf6' : '#22c55e', marginRight: 6 }}>
              {started ? '▶' : '✓'}
            </span>
            <span style={{ color: started ? '#8b5cf6' : '#22c55e', fontWeight: 600 }}>{act.agentName}</span>
            <span style={{ color: '#6b7280' }}> {started ? 'started' : 'completed'}</span>
          </div>,
        );
      }

      // ── Slash command ──
      else if (msg.type === 'slash_command') {
        const cmd = msg as AgentChatMessageSlashCommand;
        nodes.push(
          <div key={i} style={{ padding: '2px 0', fontFamily: MONO, fontSize: '0.923em' }}>
            <span style={{ color: '#6366f1', marginRight: 4 }}>$</span>
            <span style={{ color: '#6366f1', fontWeight: 600 }}>{cmd.command}</span>
            {cmd.args && <span style={{ color: '#9ca3af' }}> {cmd.args}</span>}
            <span style={{ color: '#6b7280', marginLeft: 8, fontSize: '0.77em' }}>
              {cmd.status === 'completed' ? '✓' : '\u2026'}
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
        <div style={{ padding: '16px 16px 8px', fontFamily: MONO, fontSize: '1em' }}>
          {rendered.length === 0 && isRunning && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 8 }}>
              <span style={{ color: '#6b7280', fontSize: '0.923em', fontStyle: 'italic' }}>⠿ working…</span>
              {startedAt && <ElapsedTime startedAt={startedAt} />}
            </div>
          )}
          {rendered}
          {isRunning && rendered.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ color: '#8b5cf6', fontSize: '0.923em' }}>✻</span>
              <span style={{ color: '#6b7280', fontSize: '0.923em', fontStyle: 'italic' }}>thinking…</span>
              {startedAt && <ElapsedTime startedAt={startedAt} />}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {!autoScroll && (
        <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
          <button
            type="button"
            onClick={scrollToLatest}
            style={{
              background: '#1e293b', color: '#d1d5db', border: '1px solid #374151',
              fontFamily: MONO, fontSize: '0.846em', padding: '4px 12px', borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            ↓ scroll to latest
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
