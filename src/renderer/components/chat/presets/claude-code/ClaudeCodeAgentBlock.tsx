/**
 * Claude Code preset — AgentBlock.
 *
 * Terminal-style Task/subagent rendering with no card decorations, tree
 * connectors (├/└), compact header showing tool name + status + duration,
 * collapsible internal messages and result sections.
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { AgentBlockPresetProps } from '../types';
import type { AgentChatMessageUsage } from '../../../../../shared/types';
import { ThinkingGroup } from '../../ThinkingGroup';
import { renderToolContent } from '../../../tool-renderers/renderUtils';
import { parseAgentInput, parseAgentResult, getAgentStatus, formatDuration, countToolCalls } from '../../utils/agent-parsing';

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

const STATUS_COLORS: Record<string, string> = {
  initializing: '#8b5cf6',
  running: '#3b82f6',
  completed: '#22c55e',
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

export function ClaudeCodeAgentBlock({ segment, expandedTools, onToggleTool, sessionRunning }: AgentBlockPresetProps) {
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
    <div style={{ fontFamily: MONO, fontSize: 13, margin: '4px 0', paddingLeft: 8 }}>
      {/* Header line: ● Task(description) — running 1m 23s */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: '20px' }}>
        <span style={{ color, fontSize: 14 }}>●</span>
        <span style={{ color: '#a78bfa', fontWeight: 600 }}>Task</span>
        <span style={{ color: '#9ca3af' }}>(</span>
        <span style={{ color: '#d1d5db', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agentInput.description}
        </span>
        <span style={{ color: '#9ca3af' }}>)</span>
        <span style={{ color: '#4b5563' }}>—</span>
        <span style={{ color, fontSize: 11 }}>{STATUS_LABELS[status]}</span>
        {elapsed && <span style={{ color: '#6b7280', fontSize: 11 }}>{elapsed}</span>}
        {agentInput.model && <span style={{ color: '#6b7280', fontSize: 10 }}>[{agentInput.model}]</span>}
      </div>

      {/* Metadata line */}
      {(displayToolUses > 0 || displayTokens > 0) && (
        <div style={{ paddingLeft: 20, color: '#4b5563', fontSize: 11, lineHeight: '18px' }}>
          {[
            displayToolUses > 0 ? `${displayToolUses} tool call${displayToolUses !== 1 ? 's' : ''}` : null,
            displayTokens > 0 ? `${displayTokens.toLocaleString()} tokens` : null,
          ].filter(Boolean).join(' · ')}
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
              color: '#6b7280', fontSize: 11, fontFamily: MONO, padding: '2px 0',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span>{promptExpanded ? '└' : '├'}</span>
            <span>prompt {promptExpanded ? '▾' : '▸'}</span>
          </button>
          {promptExpanded && (
            <div style={{
              marginLeft: 12, padding: '4px 8px', borderLeft: '1px solid #1e293b',
              backgroundColor: '#111827', borderRadius: 4, maxHeight: 200, overflowY: 'auto',
            }}>
              <pre style={{ color: '#9ca3af', fontSize: 11, whiteSpace: 'pre-wrap', margin: 0, fontFamily: MONO }}>
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
              color: '#6b7280', fontSize: 11, fontFamily: MONO, padding: '2px 0',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            <span>{hasResult || isRunning ? '├' : '└'}</span>
            <span>internal calls {internalExpanded ? '▾' : '▸'}</span>
          </button>
          {internalExpanded && (
            <div style={{ marginLeft: 12, paddingLeft: 8, borderLeft: '1px solid #1e293b' }}>
              <ThinkingGroup
                messages={segment.internalMessages}
                startIndex={segment.startIndex + 1}
                expandedTools={expandedTools}
                onToggleTool={onToggleTool}
                defaultExpanded
              />
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
              color: '#6b7280', fontSize: 11, fontFamily: MONO, padding: '2px 0',
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

      {/* Running indicator */}
      {isRunning && !hasResult && (
        <div style={{ paddingLeft: 20, color: '#6b7280', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <span style={{ color }}>└</span>
          <span style={{ animation: 'pulse 1.5s infinite' }}>⠿</span>
          <span>working…</span>
        </div>
      )}
    </div>
  );
}
