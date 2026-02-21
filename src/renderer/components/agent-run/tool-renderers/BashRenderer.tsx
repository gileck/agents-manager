import React from 'react';
import type { ToolRendererProps } from './types';

function parseSummary(input: string): { command: string; description?: string } {
  try {
    const parsed = JSON.parse(input);
    return {
      command: parsed.command || '...',
      description: parsed.description,
    };
  } catch { /* fallback */ }
  return { command: input.slice(0, 80) };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function BashRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const { command, description } = parseSummary(toolUse.input);
  const shortCmd = command.length > 60 ? command.slice(0, 60) + '...' : command;
  const duration = toolResult ? toolResult.timestamp - toolUse.timestamp : null;

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left font-mono"
        onClick={onToggle}
      >
        <span className="text-green-500">$</span>
        <span className="text-foreground truncate">{shortCmd}</span>
        {description && <span className="text-muted-foreground truncate ml-1">({description})</span>}
        {duration != null && (
          <span className="text-muted-foreground ml-1 flex-shrink-0">{formatDuration(duration)}</span>
        )}
        <svg className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && toolResult && (
        <div className="border-t border-border">
          <pre className="text-xs bg-muted p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
            {toolResult.result.length > 3000
              ? toolResult.result.slice(0, 3000) + '\n... (truncated)'
              : toolResult.result}
          </pre>
        </div>
      )}
      {expanded && !toolResult && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Running...
        </div>
      )}
    </div>
  );
}
