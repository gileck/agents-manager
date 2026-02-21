import React from 'react';
import type { ToolRendererProps } from './types';
import { ToolResultPreview } from './ToolResultPreview';

function parseSummary(input: string): string {
  try {
    const parsed = JSON.parse(input);
    const path = parsed.file_path || parsed.path || '';
    if (path) {
      return path.split('/').slice(-3).join('/');
    }
  } catch { /* fallback */ }
  return 'file';
}

export function EditRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const summary = parseSummary(toolUse.input);

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left font-mono"
        onClick={onToggle}
      >
        <span className="text-orange-500">Edit</span>
        <span className="text-muted-foreground truncate">{summary}</span>
        <svg className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && <ToolResultPreview toolUse={toolUse} toolResult={toolResult} showDiff />}
    </div>
  );
}
