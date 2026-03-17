/**
 * Terminal-style Read tool renderer.
 * Format: ● Read(file/path) with └ N lines summary.
 */

import React from 'react';
import type { ToolRendererProps } from '../../../../tool-renderers/types';
import {
  MONO, countLines, safeParseInput, shortPath,
  bulletStyle, connectorStyle, headerStyle, resultRowStyle,
  expandedContentStyle, preStyle, toolNameStyle, argStyle, runningStyle,
} from './terminal-tool-utils';

export function TerminalReadRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const parsed = safeParseInput(toolUse.input);
  const filePath = (parsed.file_path as string) || (parsed.path as string) || 'file';
  const display = shortPath(filePath);

  const resultText = toolResult?.result ?? '';
  const lineCount = countLines(resultText);
  const hasResult = !!toolResult;

  return (
    <div style={{ fontFamily: MONO, fontSize: '1em' }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>Read</span>
        <span style={argStyle}>(</span>
        <span style={{ color: '#60a5fa' }}>{display}</span>
        <span style={argStyle}>)</span>
      </div>

      {!hasResult && (
        <div style={resultRowStyle}>
          <span style={connectorStyle}>└ </span>
          <span style={runningStyle}>reading...</span>
        </div>
      )}

      {hasResult && (
        <div style={resultRowStyle}>
          <span style={connectorStyle}>└ </span>
          <span style={{ color: '#6b7280', fontSize: '0.923em' }}>
            {lineCount} line{lineCount !== 1 ? 's' : ''}
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
