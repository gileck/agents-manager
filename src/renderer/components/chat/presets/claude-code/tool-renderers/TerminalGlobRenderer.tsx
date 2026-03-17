/**
 * Terminal-style Glob tool renderer.
 * Format: ● Glob("pattern") with └ N files matched summary.
 */

import React from 'react';
import type { ToolRendererProps } from '../../../../tool-renderers/types';
import {
  MONO, truncateInline, countLines, safeParseInput,
  bulletStyle, connectorStyle, headerStyle, resultRowStyle,
  expandedContentStyle, preStyle, toolNameStyle, argStyle, runningStyle,
} from './terminal-tool-utils';

export function TerminalGlobRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const parsed = safeParseInput(toolUse.input);
  const pattern = (parsed.pattern as string) || '';

  const resultText = toolResult?.result ?? '';
  const fileCount = resultText ? countLines(resultText.trim()) : 0;
  const hasResult = !!toolResult;

  return (
    <div style={{ fontFamily: MONO, fontSize: '1em' }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>Glob</span>
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
          <span style={{ color: '#6b7280', fontSize: '0.923em' }}>
            {fileCount} file{fileCount !== 1 ? 's' : ''} matched
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
