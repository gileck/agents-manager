/**
 * Terminal-style Generic tool renderer (fallback).
 * Format: ● ToolName(input_summary) with collapsible input/result.
 */

import React from 'react';
import type { ToolRendererProps } from '../../../../tool-renderers/types';
import {
  MONO, truncateInline, countLines,
  bulletStyle, connectorStyle, headerStyle, resultRowStyle,
  expandedContentStyle, preStyle, toolNameStyle, argStyle, runningStyle,
} from './terminal-tool-utils';

function summarizeInput(input: string): string {
  try {
    const parsed = JSON.parse(input);
    const keys = Object.keys(parsed);
    if (keys.length === 0) return '';
    // Show first key's value if it's a short string
    const firstVal = parsed[keys[0]];
    if (typeof firstVal === 'string' && firstVal.length < 60) return firstVal;
    return keys.slice(0, 3).join(', ');
  } catch {
    return input.slice(0, 60);
  }
}

/** Extract a display name from potentially namespaced tool names (e.g., mcp__server__tool → tool). */
function displayToolName(toolName: string): string {
  // MCP format: mcp__serverKey__toolName
  if (toolName.includes('__')) {
    const parts = toolName.split('__');
    return parts[parts.length - 1];
  }
  // Dot format: server.toolName
  if (toolName.includes('.')) {
    const parts = toolName.split('.');
    return parts[parts.length - 1];
  }
  return toolName;
}

export function TerminalGenericRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const displayName = displayToolName(toolUse.toolName);
  const summary = summarizeInput(toolUse.input);

  const resultText = toolResult?.result ?? '';
  const lineCount = countLines(resultText);
  const hasResult = !!toolResult;

  return (
    <div style={{ fontFamily: MONO, fontSize: 13 }}>
      <div style={headerStyle} onClick={onToggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onToggle()}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>{displayName}</span>
        {summary && (
          <>
            <span style={argStyle}>(</span>
            <span style={{ color: '#d1d5db', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {truncateInline(summary, 60)}
            </span>
            <span style={argStyle}>)</span>
          </>
        )}
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
          <span style={{ color: '#6b7280', fontSize: 12 }}>
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
