import React from 'react';
import { Badge } from '../ui/badge';
import type { TaskArtifact } from '../../../shared/types';

interface ArtifactCardProps {
  artifact: TaskArtifact;
}

export function ArtifactCard({ artifact }: ArtifactCardProps) {
  const data = artifact.data as Record<string, unknown>;

  if (artifact.type === 'pr') {
    const url = data.url as string;
    const number = data.number as number;
    return (
      <div className="flex items-center gap-3 rounded-md border px-4 py-3">
        <span className="text-lg">&#x1F517;</span>
        <div className="flex-1">
          <div className="text-sm font-medium">Pull Request #{number}</div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-500 hover:underline break-all"
          >
            {url}
          </a>
        </div>
      </div>
    );
  }

  if (artifact.type === 'branch') {
    const branch = data.branch as string;
    return (
      <div className="flex items-center gap-3 rounded-md border px-4 py-3">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="text-muted-foreground shrink-0">
          <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">Branch</div>
          <code className="text-xs text-muted-foreground break-all">{branch}</code>
        </div>
      </div>
    );
  }

  if (artifact.type === 'diff') {
    const diff = data.diff as string;
    const lines = diff.split('\n');
    return (
      <div className="rounded-md border overflow-hidden">
        <div className="px-4 py-2 border-b bg-muted/50 flex items-center gap-2">
          <span className="text-sm font-medium">Diff</span>
          <span className="text-xs text-muted-foreground">({lines.length} lines)</span>
        </div>
        <pre className="text-xs p-3 overflow-x-auto max-h-80 overflow-y-auto">
          {lines.map((line, i) => {
            let color = 'inherit';
            if (line.startsWith('+') && !line.startsWith('+++')) color = '#22c55e';
            else if (line.startsWith('-') && !line.startsWith('---')) color = '#ef4444';
            else if (line.startsWith('@@')) color = '#6b7280';
            return <div key={i} style={{ color }}>{line || ' '}</div>;
          })}
        </pre>
      </div>
    );
  }

  // Fallback for unknown types
  return (
    <div className="flex items-start gap-2 rounded-md border px-4 py-3">
      <Badge variant="outline">{artifact.type}</Badge>
      <pre className="text-xs bg-muted p-2 rounded flex-1 overflow-x-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
