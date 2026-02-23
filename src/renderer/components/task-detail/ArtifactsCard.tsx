import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import type { TaskArtifact } from '../../../shared/types';

interface ArtifactsCardProps {
  artifacts: TaskArtifact[] | null;
}

function artifactLabel(artifact: TaskArtifact): { type: string; text: string; url?: string } {
  const data = artifact.data as Record<string, unknown>;
  if (artifact.type === 'pr') {
    return { type: 'PR', text: `#${data.number as number}`, url: data.url as string };
  }
  if (artifact.type === 'branch') {
    return { type: 'Branch', text: data.branch as string };
  }
  if (artifact.type === 'diff') {
    const lines = ((data.diff as string) ?? '').split('\n').length;
    return { type: 'Diff', text: `${lines} lines` };
  }
  return { type: artifact.type, text: JSON.stringify(data).slice(0, 40) };
}

export function ArtifactsCard({ artifacts }: ArtifactsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const items = artifacts ?? [];
  const displayItems = expanded ? items : items.slice(0, 2);
  const hasMore = items.length > 2;

  return (
    <Card>
      <CardHeader
        className="py-3 cursor-pointer select-none hover:bg-muted/50 transition-colors"
        onClick={() => items.length > 0 && setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Artifacts</CardTitle>
          <div className="flex items-center gap-2">
            {items.length > 0 && (
              <span className="text-xs text-muted-foreground">{items.length}</span>
            )}
            {hasMore && (
              <span
                className="text-xs text-muted-foreground"
                style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}
              >
                &#x25BC;
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3" style={{ overflow: 'hidden', minWidth: 0 }}>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No artifacts yet.</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            {displayItems.map((artifact) => {
              const info = artifactLabel(artifact);
              return (
                <div key={artifact.id} className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded text-purple-400 shrink-0" style={{ backgroundColor: 'rgba(168, 85, 247, 0.1)' }}>
                    {info.type}
                  </span>
                  {info.url ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); window.api.shell.openInChrome(info.url!); }}
                      className="text-blue-500 hover:underline truncate cursor-pointer"
                    >
                      {info.text}
                    </button>
                  ) : (
                    <code className="text-muted-foreground truncate">{info.text}</code>
                  )}
                </div>
              );
            })}
            {!expanded && hasMore && (
              <div className="text-muted-foreground pt-0.5 pl-1">
                +{items.length - 2} more
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
