import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ContextEntryCard } from './ContextEntryCard';
import type { TaskContextEntry } from '../../../shared/types';

interface ContextCardProps {
  entries: TaskContextEntry[];
}

export function ContextCard({ entries }: ContextCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader
        className="py-3 cursor-pointer select-none hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Context</CardTitle>
          <div className="flex items-center gap-2">
            {entries.length > 0 && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {entries.length}
              </span>
            )}
            <span
              className="text-xs text-muted-foreground"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}
            >
              &#x25BC;
            </span>
          </div>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 pb-3">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">No context entries yet.</p>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <ContextEntryCard key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
