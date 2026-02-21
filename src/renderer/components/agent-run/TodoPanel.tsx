import React from 'react';

export interface TodoItem {
  content?: string;
  subject?: string;
  status?: string;
}

interface TodoPanelProps {
  todos: TodoItem[];
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  if (status === 'in_progress') {
    return (
      <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
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

export function TodoPanel({ todos }: TodoPanelProps) {
  const completed = todos.filter((t) => t.status === 'completed').length;

  return (
    <div style={{ width: '240px' }} className="border-l border-border bg-background p-3 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-foreground">Tasks</h3>
        <span className="text-xs text-muted-foreground">{completed}/{todos.length}</span>
      </div>
      <div className="space-y-1">
        {todos.map((todo, i) => {
          const s = todo.status || 'pending';
          return (
            <div key={i} className="flex items-center gap-1.5 text-xs">
              <StatusIcon status={s} />
              <span className={
                s === 'completed' ? 'text-muted-foreground line-through' :
                s === 'in_progress' ? 'text-foreground font-semibold' :
                'text-foreground'
              }>
                {todo.subject || todo.content || 'Untitled'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
