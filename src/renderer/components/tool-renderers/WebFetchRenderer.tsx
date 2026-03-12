import React from 'react';
import type { ToolRendererProps } from './types';
import { ToolResultPreview } from './ToolResultPreview';

function parseSummary(input: string): { url: string; prompt: string } {
  try {
    const parsed = JSON.parse(input);
    return {
      url: parsed.url || '',
      prompt: parsed.prompt || '',
    };
  } catch { /* fallback */ }
  return { url: input.slice(0, 60), prompt: '' };
}

function truncateUrl(url: string, maxLen = 60): string {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen) + '...';
}

export function WebFetchRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const { url, prompt } = parseSummary(toolUse.input);

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left font-mono"
        onClick={onToggle}
      >
        <span className="text-cyan-500">WebFetch</span>
        <span className="text-muted-foreground truncate">{truncateUrl(url)}</span>
        <svg className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <>
          {prompt && (
            <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
              {prompt}
            </div>
          )}
          <ToolResultPreview toolUse={toolUse} toolResult={toolResult} />
        </>
      )}
    </div>
  );
}
