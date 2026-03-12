import React from 'react';
import type { ToolRendererProps } from './types';
import { ToolResultPreview } from './ToolResultPreview';

function parseSummary(input: string): { subagentType: string; description: string; prompt: string } {
  try {
    const parsed = JSON.parse(input);
    return {
      subagentType: parsed.subagent_type || 'agent',
      description: parsed.description || '',
      prompt: parsed.prompt || '',
    };
  } catch { /* fallback */ }
  return { subagentType: 'agent', description: input.slice(0, 60), prompt: '' };
}

export function TaskRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const { subagentType, description } = parseSummary(toolUse.input);
  const isRunning = !toolResult;

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left"
        onClick={onToggle}
      >
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-500">
          {subagentType}
        </span>
        <span className="text-muted-foreground truncate font-mono">{description}</span>
        {isRunning && (
          <span className="text-indigo-500 text-[10px] flex-shrink-0 animate-pulse">Running...</span>
        )}
        <svg className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && <ToolResultPreview toolUse={toolUse} toolResult={toolResult} />}
      {!expanded && isRunning && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Agent is working...
        </div>
      )}
    </div>
  );
}
