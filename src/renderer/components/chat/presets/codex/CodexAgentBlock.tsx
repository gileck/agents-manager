/**
 * Codex preset — AgentBlock.
 *
 * Terminal-style Task/subagent rendering matching the Codex CLI aesthetic.
 * Inherits the claude-code agent block pattern with Codex-specific color
 * accents (green/teal instead of purple/indigo).
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { AgentBlockPresetProps } from '../types';
import type { AgentChatMessageUsage } from '../../../../../shared/types';
import type { AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../../../shared/types';
import { renderToolContent } from '../../../tool-renderers/renderUtils';
import { parseAgentInput, parseAgentResult, getAgentStatus, formatDuration, countToolCalls } from '../../utils/agent-parsing';
import { getTerminalToolRenderer } from '../claude-code/tool-renderers';

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const STATUS_COLORS: Record<string, string> = {
  initializing: '#8b5cf6',
  running: '#10b981',
  completed: '#10b981',
  stopped: '#f59e0b',
  error: '#ef4444',
};

const STATUS_LABELS: Record<string, string> = {
  initializing: 'initializing\u2026',
  running: 'running',
  completed: 'completed',
  stopped: 'stopped',
  error: 'error',
};

export function CodexAgentBlock({ segment, expandedTools, onToggleTool, sessionRunning }: AgentBlockPresetProps) {
  const agentInput = useMemo(() => parseAgentInput(segment.taskToolUse.input), [segment.taskToolUse.input]);
  const status = getAgentStatus(segment, sessionRunning);
  const isRunning = status === 'running' || status === 'initializing';
  const color = STATUS_COLORS[status] ?? '#6b7280';

  const [internalExpanded, setInternalExpanded] = useState(false);
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
    <div style={{ fontFamily: MONO, fontSize: '1em', margin: '4px 0', paddingLeft: 8 }}>
      {/* Header line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '20px' }}>
        <span style={{ color, fontSize: '1.077em' }}>●</span>
        <span style={{ color: '#34d399', fontWeight: 600 }}>Task</span>
        <span style={{ color: '#9ca3af' }}>(</span>
        <span style={{ color: '#d1d5db', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agentInput.description}
        </span>
        <span style={{ color: '#9ca3af' }}>)</span>
        <span style={{ color: '#4b5563' }}>—</span>
        <span style={{ color, fontSize: '0.846em' }}>{STATUS_LABELS[status]}</span>
        {elapsed && <span style={{ color: '#6b7280', fontSize: '0.846em' }}>{elapsed}</span>}
        {agentInput.model && <span style={{ color: '#6b7280', fontSize: '0.77em' }}>[{agentInput.model}]</span>}
      </div>

      {/* Metadata line */}
      {(displayToolUses > 0 || displayTokens > 0) && (
        <div style={{ paddingLeft: 20, color: '#4b5563', fontSize: '0.846em', lineHeight: '18px' }}>
          {[
            displayToolUses > 0 ? `${displayToolUses} tool call${displayToolUses !== 1 ? 's' : ''}` : null,
            displayTokens > 0 ? `${displayTokens.toLocaleString()} tokens` : null,
          ].filter(Boolean).join(' \u00b7 ')}
        </div>
      )}

      {/* Prompt section */}
      {agentInput.prompt && (
        <div style={{ paddingLeft: 12 }}>
          <button
            type="button"
            onClick={() => setPromptExpanded((v) => !v)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#6b7280', fontSize: '0.846em', fontFamily: MONO, padding: '2px 0',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span>{promptExpanded ? '\u2514' : '\u251c'}</span>
            <span>prompt {promptExpanded ? '\u25be' : '\u25b8'}</span>
          </button>
          {promptExpanded && (
            <div style={{
              marginLeft: 12, padding: '4px 8px', borderLeft: '1px solid #1e293b',
              backgroundColor: '#111827', borderRadius: 4, maxHeight: 200, overflowY: 'auto',
            }}>
              <pre style={{ color: '#9ca3af', fontSize: '0.846em', whiteSpace: 'pre-wrap', margin: 0, fontFamily: MONO }}>
                {agentInput.prompt.length > 3000 ? agentInput.prompt.slice(0, 3000) + '\n... (truncated)' : agentInput.prompt}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Internal calls section */}
      {hasInternalMessages && (
        <div style={{ paddingLeft: 12 }}>
          <button
            type="button"
            onClick={() => setInternalExpanded((v) => !v)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#6b7280', fontSize: '0.846em', fontFamily: MONO, padding: '2px 0',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span>{hasResult || isRunning ? '\u251c' : '\u2514'}</span>
            <span>internal calls {internalExpanded ? '\u25be' : '\u25b8'}</span>
          </button>
          {internalExpanded && (
            <div style={{ marginLeft: 12, paddingLeft: 8, borderLeft: '1px solid #1e293b' }}>
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
                      <div key={idx} style={{ color: '#6b7280', fontSize: '0.923em', fontStyle: 'italic', padding: '2px 0' }}>
                        {m.text.length > 500 ? m.text.slice(0, 500) + '\u2026' : m.text}
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
          )}
        </div>
      )}

      {/* Result section */}
      {hasResult && parsedResult && (
        <div style={{ paddingLeft: 12 }}>
          <button
            type="button"
            onClick={() => setResultExpanded((v) => !v)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: '#6b7280', fontSize: '0.846em', fontFamily: MONO, padding: '2px 0',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span>└</span>
            <span>result {resultExpanded ? '▾' : '▸'}</span>
          </button>
          {resultExpanded && (
            <div style={{
              marginLeft: 12, padding: '4px 8px', borderLeft: '1px solid #1e293b',
              backgroundColor: '#111827', borderRadius: 4, maxHeight: 200, overflowY: 'auto',
            }}>
              {renderToolContent(parsedResult.cleanResult, 3000)}
            </div>
          )}
        </div>
      )}

      {/* Running indicator — thinking phase */}
      {isRunning && !hasInternalMessages && !hasResult && (
        <div style={{ paddingLeft: 20, color: '#6b7280', fontSize: '0.846em', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ color }}>└</span>
          <span style={{ color: '#10b981' }}>✻</span>
          <span style={{ fontStyle: 'italic' }}>thinking…</span>
          {elapsed && <span style={{ color: '#6b7280' }}>{elapsed}</span>}
        </div>
      )}

      {/* Running indicator — working phase */}
      {isRunning && hasInternalMessages && !hasResult && (
        <div style={{ paddingLeft: 20, color: '#6b7280', fontSize: '0.846em', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ color }}>└</span>
          <span style={{ animation: 'pulse 1.5s infinite' }}>⠿</span>
          <span>working…</span>
          {elapsed && <span style={{ color: '#6b7280' }}>{elapsed}</span>}
        </div>
      )}
    </div>
  );
}
