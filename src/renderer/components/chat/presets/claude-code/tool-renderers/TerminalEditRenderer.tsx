/**
 * Terminal-style Edit tool renderer.
 * Format: ● Edit(file/path) with └ +N/-M lines summary and expandable diff.
 */

import React from 'react';
import type { ToolRendererProps } from '../../../../tool-renderers/types';
import {
  MONO, countLines, safeParseInput, shortPath,
  bulletStyle, connectorStyle, headerStyle, resultRowStyle,
  expandedContentStyle, toolNameStyle, argStyle, runningStyle,
} from './terminal-tool-utils';

export function TerminalEditRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const parsed = safeParseInput(toolUse.input);
  const filePath = (parsed.file_path as string) || (parsed.path as string) || 'file';
  const oldStr = (parsed.old_string as string) || '';
  const newStr = (parsed.new_string as string) || '';
  const display = shortPath(filePath);

  const removedLines = countLines(oldStr);
  const addedLines = countLines(newStr);
  const hasResult = !!toolResult;

  return (
    <div style={{ fontFamily: MONO, fontSize: 13 }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>Edit</span>
        <span style={argStyle}>(</span>
        <span style={{ color: '#60a5fa' }}>{display}</span>
        <span style={argStyle}>)</span>
      </div>

      {!hasResult && (
        <div style={resultRowStyle}>
          <span style={connectorStyle}>└ </span>
          <span style={runningStyle}>editing...</span>
        </div>
      )}

      {hasResult && (
        <div style={resultRowStyle}>
          <span style={connectorStyle}>└ </span>
          <span style={{ fontSize: 12 }}>
            <span style={{ color: '#22c55e' }}>+{addedLines}</span>
            <span style={{ color: '#6b7280' }}>/</span>
            <span style={{ color: '#ef4444' }}>-{removedLines}</span>
            <span style={{ color: '#6b7280' }}> lines</span>
          </span>
        </div>
      )}

      {hasResult && expanded && (oldStr || newStr) && (
        <div style={expandedContentStyle}>
          {oldStr && (
            <div style={{ marginBottom: 4 }}>
              {oldStr.split('\n').map((line, i) => (
                <div key={`old-${i}`} style={{ color: '#ef4444', fontSize: 11, fontFamily: MONO, whiteSpace: 'pre-wrap', backgroundColor: 'rgba(239,68,68,0.08)' }}>
                  - {line}
                </div>
              ))}
            </div>
          )}
          {newStr && (
            <div>
              {newStr.split('\n').map((line, i) => (
                <div key={`new-${i}`} style={{ color: '#22c55e', fontSize: 11, fontFamily: MONO, whiteSpace: 'pre-wrap', backgroundColor: 'rgba(34,197,94,0.08)' }}>
                  + {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
