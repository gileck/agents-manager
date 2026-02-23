import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

interface GitStatusCardProps {
  taskId: string;
}

interface StatusEntry {
  status: string;
  filepath: string;
}

function parseStatus(raw: string): StatusEntry[] {
  if (!raw.trim()) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const status = line.substring(0, 2).trim();
    const filepath = line.substring(3);
    return { status, filepath };
  });
}

function statusColor(status: string): string {
  if (status === 'M') return '#e3b341';
  if (status === 'A') return '#3fb950';
  if (status === 'D') return '#f85149';
  if (status === '??' || status === '?') return '#58a6ff';
  return '#8b949e';
}

export function GitStatusCard({ taskId }: GitStatusCardProps) {
  const [entries, setEntries] = useState<StatusEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const statusRaw = await window.api.git.status(taskId);
      setEntries(parseStatus(statusRaw ?? ''));
    } catch (err) {
      console.error('GitStatusCard: failed to fetch git status', err);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Git</CardTitle>
          {entries.length > 0 && (
            <span className="text-xs text-muted-foreground">{entries.length} changes</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No working changes.</p>
        ) : (
          <div className="space-y-0.5">
            {entries.slice(0, 6).map((entry) => (
              <div key={entry.filepath} className="flex items-center gap-1.5 text-xs font-mono">
                <span
                  className="font-bold text-[10px] px-1 rounded"
                  style={{ color: statusColor(entry.status) }}
                >
                  {entry.status}
                </span>
                <span className="text-muted-foreground truncate">{entry.filepath}</span>
              </div>
            ))}
            {entries.length > 6 && (
              <div className="text-xs text-muted-foreground mt-1">
                +{entries.length - 6} more files
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
