import React from 'react';
import type { ToolRendererProps } from './types';
import { ToolResultPreview } from './ToolResultPreview';

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

export function BashRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const { command, description } = parseSummary(toolUse.input);
  const shortCmd = command.length > 60 ? command.slice(0, 60) + '...' : command;

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left font-mono"
        onClick={onToggle}
      >
        <span className="text-green-500">$</span>
        <span className="text-foreground truncate">{shortCmd}</span>
        {description && <span className="text-muted-foreground truncate ml-1">({description})</span>}
        <svg className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && <ToolResultPreview toolUse={toolUse} toolResult={toolResult} />}
    </div>
  );
}
