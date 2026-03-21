/**
 * Codex preset — AgentBlock.
 *
 * Clean card/collapsible section for Task/subagent rendering.
 * Uses proportional (sans-serif) fonts and rounded containers
 * instead of terminal tree connectors.
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { AgentBlockPresetProps } from '../types';
import type { AgentChatMessageUsage } from '../../../../../shared/types';
import type { AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../../../shared/types';
import { renderToolContent } from '../../../tool-renderers/renderUtils';
import { parseAgentInput, parseAgentResult, getAgentStatus, formatDuration, countToolCalls } from '../../utils/agent-parsing';
import { getTerminalToolRenderer } from '../claude-code/tool-renderers';

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const STATUS_COLORS: Record<string, string> = {
  initializing: '#8b5cf6',
  running: '#f59e0b',
  completed: '#888',
  stopped: '#f59e0b',
  error: '#ef4444',
};

const STATUS_LABELS: Record<string, string> = {
  initializing: 'initializing…',
  running: 'running',
  completed: 'completed',
  stopped: 'stopped',
  error: 'error',
};

export function CodexAgentBlock({ segment, expandedTools, onToggleTool, sessionRunning, isWaitingForInput }: AgentBlockPresetProps) {
  const agentInput = useMemo(() => parseAgentInput(segment.taskToolUse.input), [segment.taskToolUse.input]);
  const status = getAgentStatus(segment, sessionRunning);
  const isRunning = status === 'running' || status === 'initializing';
  const color = STATUS_COLORS[status] ?? '#888';

  const [expanded, setExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);

  // Elapsed timer
  const [elapsed, setElapsed] = useState('');
  useEffect(() => {
    const startTs = segment.startedActivity?.timestamp ?? segment.taskToolUse.timestamp;
    const endTs = segment.completedActivity?.timestamp;
    if (endTs) { setElapsed(formatDuration(endTs - startTs)); return; }
    setElapsed(formatDuration(Date.now() - startTs));
    const interval = setInterval(() => setElapsed(formatDuration(Date.now() - startTs)), 1000);
    return () => clearInterval(interval);
  }, [segment.startedActivity?.timestamp, segment.completedActivity?.timestamp, segment.taskToolUse.timestamp]);

  // Token usage
  const { totalInputTokens, totalOutputTokens } = useMemo(() => {
    let inp = 0, out = 0;
    for (const msg of segment.internalMessages) {
      if (msg.type === 'usage') {
        const u = msg as AgentChatMessageUsage;
        inp += u.inputTokens;
        out += u.outputTokens;
      }
    }
    return { totalInputTokens: inp, totalOutputTokens: out };
  }, [segment.internalMessages]);

  const totalTokens = totalInputTokens + totalOutputTokens;
  const toolCallCount = useMemo(() => countToolCalls(segment.internalMessages), [segment.internalMessages]);
  const parsedResult = useMemo(() => segment.taskToolResult ? parseAgentResult(segment.taskToolResult.result) : null, [segment.taskToolResult]);
  const displayTokens = totalTokens > 0 ? totalTokens : (parsedResult?.totalTokens ?? 0);
  const displayToolUses = toolCallCount > 0 ? toolCallCount : (parsedResult?.toolUses ?? 0);
  const hasInternalMessages = segment.internalMessages.length > 0;
  const hasResult = !!segment.taskToolResult && !!parsedResult;

  return (
    <div style={{
      fontFamily: SANS,
      fontSize: '1em',
      margin: '8px 0',
      borderRadius: 8,
      border: '1px solid #2a2a2a',
      backgroundColor: '#161616',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          cursor: hasInternalMessages || hasResult || agentInput.prompt ? 'pointer' : 'default',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {(hasInternalMessages || hasResult || agentInput.prompt) && (
          <span style={{
            color: '#888',
            fontSize: '0.7em',
            transition: 'transform 0.15s',
            transform: expanded ? 'rotate(90deg)' : 'none',
            flexShrink: 0,
          }}>▶</span>
        )}
        <span style={{ color: '#e5e7eb', fontWeight: 600, flexShrink: 0 }}>Task</span>
        <span style={{
          color: '#d1d5db',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: '0.95em',
        }}>
          {agentInput.description}
        </span>
        <span style={{ color, fontSize: '0.8em', fontWeight: 500, flexShrink: 0 }}>
          {STATUS_LABELS[status]}
        </span>
        {elapsed && (
          <span style={{ color: '#888', fontSize: '0.8em', flexShrink: 0 }}>{elapsed}</span>
        )}
      </div>

      {/* ── Metadata ── */}
      {(displayToolUses > 0 || displayTokens > 0 || agentInput.model) && (
        <div style={{
          padding: '0 14px 8px',
          paddingLeft: hasInternalMessages || hasResult || agentInput.prompt ? 36 : 14,
          color: '#888',
          fontSize: '0.8em',
          display: 'flex',
          gap: 12,
        }}>
          {displayToolUses > 0 && <span>{displayToolUses} tool call{displayToolUses !== 1 ? 's' : ''}</span>}
          {displayTokens > 0 && <span>{displayTokens.toLocaleString()} tokens</span>}
          {agentInput.model && <span>{agentInput.model}</span>}
        </div>
      )}

      {/* ── Expanded details ── */}
      {expanded && (
        <div style={{ borderTop: '1px solid #2a2a2a' }}>
          {/* Prompt section */}
          {agentInput.prompt && (
            <div style={{ borderBottom: (hasInternalMessages || hasResult) ? '1px solid #2a2a2a' : undefined }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setPromptExpanded((v) => !v); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#888',
                  fontSize: '0.8em',
                  fontFamily: SANS,
                  padding: '8px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  fontSize: '0.75em',
                  transition: 'transform 0.15s',
                  transform: promptExpanded ? 'rotate(90deg)' : 'none',
                }}>▶</span>
                Prompt
              </button>
              {promptExpanded && (
                <div style={{
                  margin: '0 14px 8px',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a1a',
                  borderRadius: 6,
                  maxHeight: 200,
                  overflowY: 'auto',
                }}>
                  <pre style={{
                    color: '#9ca3af',
                    fontSize: '0.8em',
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                    fontFamily: MONO,
                  }}>
                    {agentInput.prompt.length > 3000 ? agentInput.prompt.slice(0, 3000) + '\n... (truncated)' : agentInput.prompt}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Internal calls */}
          {hasInternalMessages && (
            <div style={{
              padding: '8px 14px',
              borderBottom: hasResult ? '1px solid #2a2a2a' : undefined,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {(() => {
                  const resultMap = new Map<string, AgentChatMessageToolResult>();
                  for (const m of segment.internalMessages) {
                    if (m.type === 'tool_result' && m.toolId) {
                      resultMap.set(m.toolId, m as AgentChatMessageToolResult);
                    }
                  }
                  return segment.internalMessages.map((m, idx) => {
                    const globalIdx = segment.startIndex + 1 + idx;
                    if (m.type === 'thinking') {
                      return (
                        <div key={idx} style={{
                          color: '#888',
                          fontSize: '0.85em',
                          fontStyle: 'italic',
                          padding: '2px 0',
                          fontFamily: SANS,
                        }}>
                          {m.text.length > 500 ? m.text.slice(0, 500) + '…' : m.text}
                        </div>
                      );
                    }
                    if (m.type === 'tool_use') {
                      const tu = m as AgentChatMessageToolUse;
                      const tr = tu.toolId ? resultMap.get(tu.toolId) : undefined;
                      const Renderer = getTerminalToolRenderer(tu.toolName);
                      return (
                        <Renderer
                          key={idx}
                          toolUse={tu}
                          toolResult={tr}
                          expanded={expandedTools.has(globalIdx)}
                          onToggle={() => onToggleTool(globalIdx)}
                        />
                      );
                    }
                    return null;
                  });
                })()}
              </div>
            </div>
          )}

          {/* Result section */}
          {hasResult && parsedResult && (
            <div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setResultExpanded((v) => !v); }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#888',
                  fontSize: '0.8em',
                  fontFamily: SANS,
                  padding: '8px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <span style={{
                  fontSize: '0.75em',
                  transition: 'transform 0.15s',
                  transform: resultExpanded ? 'rotate(90deg)' : 'none',
                }}>▶</span>
                Result
              </button>
              {resultExpanded && (
                <div style={{
                  margin: '0 14px 8px',
                  padding: '8px 12px',
                  backgroundColor: '#1a1a1a',
                  borderRadius: 6,
                  maxHeight: 200,
                  overflowY: 'auto',
                }}>
                  {renderToolContent(parsedResult.cleanResult, 3000)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Running indicators ── */}
      {isRunning && !hasInternalMessages && !hasResult && !isWaitingForInput && (
        <div style={{
          padding: '4px 14px 10px',
          paddingLeft: 36,
          color: '#888',
          fontSize: '0.85em',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{ color: '#f59e0b', animation: 'pulse 1.5s infinite' }}>●</span>
          <span style={{ fontStyle: 'italic' }}>Thinking…</span>
          {elapsed && <span>{elapsed}</span>}
        </div>
      )}

      {isRunning && hasInternalMessages && !hasResult && !isWaitingForInput && (
        <div style={{
          padding: '4px 14px 10px',
          paddingLeft: 36,
          color: '#888',
          fontSize: '0.85em',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{ animation: 'pulse 1.5s infinite' }}>⠿</span>
          <span>Working…</span>
          {elapsed && <span>{elapsed}</span>}
        </div>
      )}
    </div>
  );
}
