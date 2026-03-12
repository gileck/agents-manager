import React from 'react';
import type { ToolRendererProps } from './types';
import { ToolResultPreview } from './ToolResultPreview';

function parseSummary(input: string): { query: string; allowedDomains?: string[]; blockedDomains?: string[] } {
  try {
    const parsed = JSON.parse(input);
    return {
      query: parsed.query || '',
      allowedDomains: parsed.allowed_domains,
      blockedDomains: parsed.blocked_domains,
    };
  } catch { /* fallback */ }
  return { query: input.slice(0, 60) };
}

export function WebSearchRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const { query, allowedDomains, blockedDomains } = parseSummary(toolUse.input);
  const hasDomainFilters = (allowedDomains && allowedDomains.length > 0) || (blockedDomains && blockedDomains.length > 0);

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left font-mono"
        onClick={onToggle}
      >
        <span className="text-amber-500">WebSearch</span>
        <span className="text-muted-foreground truncate">&ldquo;{query}&rdquo;</span>
        <svg className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <>
          {hasDomainFilters && (
            <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground flex flex-wrap gap-1.5">
              {allowedDomains && allowedDomains.length > 0 && (
                <span>
                  <span className="font-medium">Only:</span> {allowedDomains.join(', ')}
                </span>
              )}
              {blockedDomains && blockedDomains.length > 0 && (
                <span>
                  <span className="font-medium">Blocked:</span> {blockedDomains.join(', ')}
                </span>
              )}
            </div>
          )}
          <ToolResultPreview toolUse={toolUse} toolResult={toolResult} />
        </>
      )}
    </div>
  );
}
