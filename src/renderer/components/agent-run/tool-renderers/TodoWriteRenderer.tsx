import React from 'react';
import type { ToolRendererProps } from './types';
import type { TodoItem } from '../TodoPanel';
import { ToolResultPreview } from './ToolResultPreview';

function parseTodos(input: string): TodoItem[] {
  try {
    const parsed = JSON.parse(input);
    return parsed.todos || [];
  } catch { /* fallback */ }
  return [];
}

export function TodoWriteRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const todos = parseTodos(toolUse.input);
  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left font-mono"
        onClick={onToggle}
      >
        <span className="text-teal-500">Todos</span>
        <span className="text-muted-foreground">({completed}/{total} completed)</span>
        <svg className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && <ToolResultPreview toolUse={toolUse} toolResult={toolResult} />}
    </div>
  );
}
