import React from 'react';
import type { TaskContextEntry } from '../../../shared/types';

const CONTEXT_SOURCE_COLORS: Record<string, string> = {
  agent: '#3b82f6',
  reviewer: '#f59e0b',
  'workflow-reviewer': '#e879f9',
  system: '#6b7280',
  user: '#8b5cf6',
};

export function ContextEntryCard({ entry }: { entry: TaskContextEntry }) {
  const sourceColor = CONTEXT_SOURCE_COLORS[entry.source] ?? '#6b7280';
  return (
    <div className="rounded-md border px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="px-2 py-0.5 rounded text-xs font-semibold text-white"
          style={{ backgroundColor: sourceColor }}
        >
          {entry.source}
        </span>
        <span className="text-xs text-muted-foreground font-medium">
          {entry.entryType.replace(/_/g, ' ')}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(entry.createdAt).toLocaleString()}
        </span>
      </div>
      <pre className="text-sm whitespace-pre-wrap break-words bg-muted p-3 rounded max-h-[400px] overflow-y-auto">
        {entry.summary}
      </pre>
    </div>
  );
}
