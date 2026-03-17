/**
 * Terminal-style Bash tool renderer.
 * Format: ● Bash(command...) with collapsible output via └ connector.
 */

import React, { useState } from 'react';
import type { ToolRendererProps } from '../../../../tool-renderers/types';
import {
  MONO, truncateInline, countLines, safeParseInput,
  bulletStyle, connectorStyle, headerStyle, resultRowStyle,
  expandedContentStyle, preStyle, toolNameStyle, argStyle, runningStyle,
} from './terminal-tool-utils';

export function TerminalBashRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const [resultExpanded, setResultExpanded] = useState(false);
  const parsed = safeParseInput(toolUse.input);
  const command = (parsed.command as string) || toolUse.input.slice(0, 120);

  const resultText = toolResult?.result ?? '';
  const lineCount = countLines(resultText);
  const hasResult = !!toolResult;

  return (
    <div style={{ fontFamily: MONO, fontSize: 13 }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>Bash</span>
        <span style={argStyle}>(</span>
        <span style={{ color: '#d1d5db', maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {truncateInline(command, 80)}
        </span>
        <span style={argStyle}>)</span>
      </div>

      {!hasResult && (
        <div style={resultRowStyle}>
          <span style={connectorStyle}>└ </span>
          <span style={runningStyle}>running...</span>
        </div>
      )}

      {hasResult && (
        <div style={resultRowStyle}>
          <span style={connectorStyle}>└ </span>
          <button
            type="button"
            onClick={() => setResultExpanded((v) => !v)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontFamily: MONO, fontSize: 12, color: '#6b7280' }}
          >
            {resultExpanded ? '▾' : '▸'} {lineCount} line{lineCount !== 1 ? 's' : ''} of output
          </button>
        </div>
      )}

      {hasResult && (expanded || resultExpanded) && (
        <div style={expandedContentStyle}>
          <pre style={preStyle}>
            {resultText.length > 5000 ? resultText.slice(0, 5000) + '\n... (truncated)' : resultText}
          </pre>
        </div>
      )}
    </div>
  );
}
