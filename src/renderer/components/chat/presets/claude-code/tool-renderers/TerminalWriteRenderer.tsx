/**
 * Terminal-style Write tool renderer.
 * Format: ● Write(file/path) with └ Wrote N lines summary.
 */

import React from 'react';
import type { ToolRendererProps } from '../../../../tool-renderers/types';
import {
  MONO, countLines, safeParseInput, shortPath,
  bulletStyle, connectorStyle, headerStyle, resultRowStyle,
  expandedContentStyle, preStyle, toolNameStyle, argStyle, runningStyle,
} from './terminal-tool-utils';

export function TerminalWriteRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const parsed = safeParseInput(toolUse.input);
  const filePath = (parsed.file_path as string) || (parsed.path as string) || 'file';
  const content = (parsed.content as string) || '';
  const display = shortPath(filePath);
  const lineCount = countLines(content);

  const hasResult = !!toolResult;

  return (
    <div style={{ fontFamily: MONO, fontSize: '1em' }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>Write</span>
        <span style={argStyle}>(</span>
        <span style={{ color: '#60a5fa' }}>{display}</span>
        <span style={argStyle}>)</span>
      </div>

      {!hasResult && (
        <div style={resultRowStyle}>
          <span style={connectorStyle}>└ </span>
          <span style={runningStyle}>writing...</span>
        </div>
      )}

      {hasResult && (
        <div style={resultRowStyle}>
          <span style={connectorStyle}>└ </span>
          <span style={{ color: '#22c55e', fontSize: '0.923em' }}>
            Wrote {lineCount} line{lineCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {hasResult && expanded && content && (
        <div style={expandedContentStyle}>
          <pre style={preStyle}>
            {content.length > 5000 ? content.slice(0, 5000) + '\n... (truncated)' : content}
          </pre>
        </div>
      )}
    </div>
  );
}
