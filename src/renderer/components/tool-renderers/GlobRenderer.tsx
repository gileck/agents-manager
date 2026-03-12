import React from 'react';
import type { ToolRendererProps } from './types';
import { ToolResultPreview } from './ToolResultPreview';

function parseSummary(input: string): string {
  try {
    const parsed = JSON.parse(input);
    const pattern = parsed.pattern || '';
    const path = parsed.path || '';
    const shortPath = path ? path.split('/').slice(-2).join('/') : '';
    return `"${pattern}"${shortPath ? ` in ${shortPath}` : ''}`;
  } catch { /* fallback */ }
  return input.slice(0, 60);
}

function parseFileCount(result: string): number | null {
  try {
    const lines = result.trim().split('\n').filter((l: string) => l.trim());
    return lines.length;
  } catch {
    return null;
  }
}

export function GlobRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const summary = parseSummary(toolUse.input);
  const fileCount = toolResult ? parseFileCount(toolResult.result) : null;

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left font-mono"
        onClick={onToggle}
      >
        <span className="text-emerald-500">Glob</span>
        <span className="text-muted-foreground truncate">{summary}</span>
        {fileCount != null && (
          <span className="text-muted-foreground flex-shrink-0">· {fileCount} {fileCount === 1 ? 'match' : 'matches'}</span>
        )}
        <svg className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && <ToolResultPreview toolUse={toolUse} toolResult={toolResult} />}
    </div>
  );
}
