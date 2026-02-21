import React from 'react';

export interface TodoItem {
  content?: string;
  subject?: string;
  status?: string;
}

interface TodoPanelProps {
  todos: TodoItem[];
}

const STATUS_ICONS: Record<string, string> = {
  completed: '\u2705',
  in_progress: '\u23F3',
  pending: '\u25CB',
};

export function TodoPanel({ todos }: TodoPanelProps) {
  const completed = todos.filter((t) => t.status === 'completed').length;

  return (
    <div style={{ width: '240px' }} className="border-l border-border bg-background p-3 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-foreground">Tasks</h3>
        <span className="text-xs text-muted-foreground">{completed}/{todos.length}</span>
      </div>
      <div className="space-y-1">
        {todos.map((todo, i) => (
          <div key={i} className="flex items-start gap-1.5 text-xs">
            <span className="flex-shrink-0 mt-0.5">{STATUS_ICONS[todo.status || 'pending'] || '\u25CB'}</span>
            <span className={todo.status === 'completed' ? 'text-muted-foreground line-through' : 'text-foreground'}>
              {todo.subject || todo.content || 'Untitled'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
