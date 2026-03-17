/**
 * Terminal-style TodoWrite tool renderer.
 * Format: ● Todos(N/M completed) with inline progress items.
 */

import React from 'react';
import type { ToolRendererProps } from '../../../../tool-renderers/types';
import {
  MONO, safeParseInput,
  bulletStyle, headerStyle, toolNameStyle, argStyle,
} from './terminal-tool-utils';

interface TodoItem {
  content: string;
  status: string;
  activeForm?: string;
}

function parseTodos(input: string): TodoItem[] {
  const parsed = safeParseInput(input);
  return (parsed.todos as TodoItem[]) || [];
}

const STATUS_ICON: Record<string, { icon: string; color: string }> = {
  completed: { icon: '\u2713', color: '#22c55e' },
  in_progress: { icon: '\u25cf', color: '#3b82f6' },
  pending: { icon: '\u25cb', color: '#6b7280' },
};

export function TerminalTodoWriteRenderer({ toolUse }: ToolRendererProps) {
  const todos = parseTodos(toolUse.input);
  const completed = todos.filter((t) => t.status === 'completed').length;
  const inProgress = todos.find((t) => t.status === 'in_progress');

  return (
    <div style={{ fontFamily: MONO, fontSize: '1em' }}>
      <div style={{ ...headerStyle, cursor: 'default' }}>
        <span style={bulletStyle}>●</span>
        <span style={toolNameStyle}>Todos</span>
        <span style={argStyle}>(</span>
        <span style={{ color: '#22c55e' }}>{completed}</span>
        <span style={{ color: '#6b7280' }}>/{todos.length}</span>
        <span style={argStyle}>)</span>
        {inProgress && (
          <span style={{ color: '#3b82f6', fontSize: '0.846em', fontStyle: 'italic', marginLeft: 4 }}>
            {inProgress.activeForm || inProgress.content}
          </span>
        )}
      </div>

      <div style={{ paddingLeft: 20, fontSize: '0.846em' }}>
        {todos.map((todo, i) => {
          const { icon, color } = STATUS_ICON[todo.status] || STATUS_ICON.pending;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0', color }}>
              <span style={{ fontSize: '0.77em', width: 12, textAlign: 'center' }}>{icon}</span>
              <span style={{ color: todo.status === 'completed' ? '#6b7280' : '#d1d5db' }}>
                {todo.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
