/**
 * Terminal-style Grep tool renderer.
 * Format: ● Grep("pattern") with └ N matches summary.
 */

import React from 'react';
import type { ToolRendererProps } from '../../../../tool-renderers/types';
import {
  MONO, truncateInline, countLines, safeParseInput,
  bulletStyle, connectorStyle, headerStyle, resultRowStyle,
  expandedContentStyle, preStyle, toolNameStyle, argStyle, runningStyle,
} from './terminal-tool-utils';

export function TerminalGrepRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const parsed = safeParseInput(toolUse.input);
  const pattern = (parsed.pattern as string) || (parsed.query as string) || '';

  const resultText = toolResult?.result ?? '';
  const matchCount = resultText ? countLines(resultText) : 0;
  const hasResult = !!toolResult;

  return (
    <div style={{ fontFamily: MONO, fontSize: 13 }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>Grep</span>
        <span style={argStyle}>(</span>
        <span style={{ color: '#fbbf24' }}>&quot;{truncateInline(pattern, 50)}&quot;</span>
        <span style={argStyle}>)</span>
      </div>

      {!hasResult && (
        <div style={resultRowStyle}>
          <span style={connectorStyle}>└ </span>
          <span style={runningStyle}>searching...</span>
        </div>
      )}

      {hasResult && (
        <div style={resultRowStyle}>
          <span style={connectorStyle}>└ </span>
          <span style={{ color: '#6b7280', fontSize: 12 }}>
            {matchCount} match{matchCount !== 1 ? 'es' : ''}
          </span>
        </div>
      )}

      {hasResult && expanded && (
        <div style={expandedContentStyle}>
          <pre style={preStyle}>
            {resultText.length > 5000 ? resultText.slice(0, 5000) + '\n... (truncated)' : resultText}
          </pre>
        </div>
      )}
    </div>
  );
}
