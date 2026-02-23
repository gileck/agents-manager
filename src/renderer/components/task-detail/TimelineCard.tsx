import React, { useState } from 'react';
import { Card, CardHeader, CardTitle } from '../ui/card';
import { DebuggerPanel } from '../pipeline/DebuggerPanel';
import type { DebugTimelineEntry } from '../../../shared/types';

interface TimelineCardProps {
  entries: DebugTimelineEntry[];
}

export function TimelineCard({ entries }: TimelineCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card style={{ overflow: 'hidden' }}>
      <CardHeader
        className="py-3 cursor-pointer select-none hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Timeline</CardTitle>
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
        <div style={{ overflow: 'hidden', width: '100%' }} className="border-t pb-3">
          <div style={{ maxWidth: '100%', overflow: 'auto' }} className="px-4">
            <DebuggerPanel entries={entries} />
          </div>
        </div>
      )}
    </Card>
  );
}
