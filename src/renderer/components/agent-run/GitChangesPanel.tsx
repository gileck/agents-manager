import React, { useState } from 'react';
import { Button } from '../ui/button';
import { RefreshCw } from 'lucide-react';

interface GitChangesPanelProps {
  diff: string | null;
  stat: string | null;
  onRefresh: () => void;
  loading?: boolean;
}

const MAX_LINES = 500;

export function GitChangesPanel({ diff, stat, onRefresh, loading }: GitChangesPanelProps) {
  const [showAll, setShowAll] = useState(false);

  if (diff === null && stat === null) {
    return (
      <div className="p-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">No worktree available yet.</p>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
    );
  }

  const lines = (diff || '').split('\n');
  const truncated = !showAll && lines.length > MAX_LINES;
  const displayLines = truncated ? lines.slice(0, MAX_LINES) : lines;

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        {stat && (
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap flex-1">{stat}</pre>
        )}
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} className="shrink-0 ml-2">
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {diff && (
        <pre className="text-xs p-3 overflow-x-auto max-h-80 overflow-y-auto bg-muted rounded">
          {displayLines.map((line, i) => {
            let color = 'inherit';
            if (line.startsWith('+') && !line.startsWith('+++')) color = '#22c55e';
            else if (line.startsWith('-') && !line.startsWith('---')) color = '#ef4444';
            else if (line.startsWith('@@')) color = '#6b7280';
            return <div key={i} style={{ color }}>{line || ' '}</div>;
          })}
          {truncated && (
            <div className="pt-2">
              <Button variant="link" size="sm" className="text-xs p-0 h-auto" onClick={() => setShowAll(true)}>
                Show all {lines.length} lines
              </Button>
            </div>
          )}
        </pre>
      )}
    </div>
  );
}
