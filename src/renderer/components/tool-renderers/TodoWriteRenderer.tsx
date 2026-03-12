import React from 'react';
import type { ToolRendererProps } from './types';
import type { TodoItem } from '../agent-run/TodoPanel';

/** Extends the shared TodoItem with the activeForm field used by the TodoWrite tool. */
interface TodoWriteItem extends TodoItem {
  activeForm?: string;
}

function parseTodos(input: string): TodoWriteItem[] {
  try {
    const parsed = JSON.parse(input);
    return parsed.todos || [];
  } catch { /* fallback */ }
  return [];
}

function TodoStatusIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (status === 'in_progress') {
    return (
      <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
      </svg>
    );
  }
  // pending / unknown
  return (
    <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function TodoWriteRenderer({ toolUse }: ToolRendererProps) {
  const todos = parseTodos(toolUse.input);
  const completed = todos.filter((t) => t.status === 'completed').length;
  const total = todos.length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  if (total === 0) {
    return (
      <div className="border border-border rounded my-1 p-3 bg-card text-xs text-muted-foreground">
        No tasks
      </div>
    );
  }

  return (
    <div className="border border-border rounded my-1 bg-card overflow-hidden">
      {/* Header with progress bar */}
      <div className="px-3 py-2 border-b border-border/60 bg-muted/30 flex items-center gap-3">
        <span className="text-xs font-medium text-teal-500">Todos</span>
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-teal-500 rounded-full transition-all"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {completed}/{total}
        </span>
      </div>

      {/* Todo items */}
      <div className="divide-y divide-border/30">
        {todos.map((todo, i) => {
          const s = todo.status || 'pending';
          const isInProgress = s === 'in_progress';
          const isCompleted = s === 'completed';
          const text = isInProgress
            ? (todo.activeForm || todo.content || 'Untitled')
            : (todo.content || 'Untitled');

          return (
            <div
              key={i}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs${
                isInProgress ? ' bg-blue-500/10' : ''
              }`}
            >
              <TodoStatusIcon status={s} />
              <span className={
                isCompleted ? 'text-muted-foreground line-through' :
                isInProgress ? 'text-foreground font-medium' :
                'text-foreground'
              }>
                {text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
