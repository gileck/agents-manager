import React from 'react';
import type { TaskContextEntry } from '../../../shared/types';

interface CommentThreadProps {
  entries: TaskContextEntry[];
  emptyMessage?: string;
}

export function CommentThread({ entries, emptyMessage = 'No comments yet.' }: CommentThreadProps) {
  if (!entries || entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{emptyMessage}</p>
    );
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-md bg-muted px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold">{entry.source}</span>
            <span className="text-xs text-muted-foreground">
              {new Date(entry.createdAt).toLocaleString()}
            </span>
            {entry.addressed && (
              <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">addressed</span>
            )}
          </div>
          <p className="text-sm whitespace-pre-wrap">{entry.summary}</p>
        </div>
      ))}
    </div>
  );
}
