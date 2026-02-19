import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import type { GitLogEntry } from '../../../shared/types';

interface GitTabProps {
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
  if (status === 'M') return 'text-yellow-500';
  if (status === 'A') return 'text-green-500';
  if (status === 'D') return 'text-red-500';
  if (status === '??' || status === '?') return 'text-blue-400';
  return 'text-muted-foreground';
}

function statusLabel(status: string): string {
  if (status === 'M') return 'Modified';
  if (status === 'A') return 'Added';
  if (status === 'D') return 'Deleted';
  if (status === '??' || status === '?') return 'Untracked';
  return status;
}

const MAX_DIFF_LINES = 500;

function DiffBlock({ diff, maxLines }: { diff: string; maxLines?: number }) {
  const [showAll, setShowAll] = useState(false);
  const lines = diff.split('\n');
  const limit = maxLines ?? MAX_DIFF_LINES;
  const truncated = !showAll && lines.length > limit;
  const displayLines = truncated ? lines.slice(0, limit) : lines;

  return (
    <pre className="text-xs p-3 overflow-x-auto max-h-96 overflow-y-auto bg-muted rounded">
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
  );
}

export function GitTab({ taskId }: GitTabProps) {
  const [statusEntries, setStatusEntries] = useState<StatusEntry[]>([]);
  const [diff, setDiff] = useState<string | null>(null);
  const [commits, setCommits] = useState<GitLogEntry[] | null>(null);
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [commitDiffs, setCommitDiffs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRaw, diffRaw, logResult] = await Promise.all([
        window.api.git.status(taskId),
        window.api.git.workingDiff(taskId),
        window.api.git.log(taskId),
      ]);
      setStatusEntries(parseStatus(statusRaw ?? ''));
      setDiff(diffRaw);
      setCommits(logResult);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load git data');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleResetFile = async (filepath: string) => {
    setActionLoading(`reset:${filepath}`);
    try {
      await window.api.git.resetFile(taskId, filepath);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reset file');
    } finally {
      setActionLoading(null);
    }
  };

  const handleClean = async () => {
    setActionLoading('clean');
    try {
      await window.api.git.clean(taskId);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to clean');
    } finally {
      setActionLoading(null);
    }
  };

  const handlePull = async () => {
    setActionLoading('pull');
    try {
      await window.api.git.pull(taskId);
      await refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to pull');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleCommit = async (hash: string) => {
    if (expandedCommit === hash) {
      setExpandedCommit(null);
      return;
    }
    setExpandedCommit(hash);
    if (!commitDiffs[hash]) {
      try {
        const result = await window.api.git.show(taskId, hash);
        if (result) {
          setCommitDiffs((prev) => ({ ...prev, [hash]: result }));
        }
      } catch {
        // ignore
      }
    }
  };

  if (error) {
    return (
      <Card className="mt-4">
        <CardContent className="py-4">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={refresh}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
        <Button variant="outline" size="sm" onClick={handlePull} disabled={actionLoading !== null}>
          {actionLoading === 'pull' ? 'Pulling...' : 'Pull from Main'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClean}
          disabled={actionLoading !== null || statusEntries.length === 0}
        >
          {actionLoading === 'clean' ? 'Cleaning...' : 'Clean All'}
        </Button>
      </div>

      {/* Working Changes */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">
            Working Changes
            {statusEntries.length > 0 && (
              <Badge variant="secondary" className="ml-2">{statusEntries.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : statusEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No uncommitted changes.</p>
          ) : (
            <div className="space-y-1">
              {statusEntries.map((entry) => (
                <div key={entry.filepath} className="flex items-center gap-2 py-1 text-sm font-mono">
                  <Badge variant="outline" className={`text-xs ${statusColor(entry.status)}`}>
                    {statusLabel(entry.status)}
                  </Badge>
                  <span className="flex-1 truncate">{entry.filepath}</span>
                  {entry.status !== '??' && entry.status !== '?' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-6"
                      onClick={() => handleResetFile(entry.filepath)}
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === `reset:${entry.filepath}` ? '...' : 'Reset'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {diff && (
            <div className="mt-3">
              <DiffBlock diff={diff} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Commits */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Commits</CardTitle>
        </CardHeader>
        <CardContent>
          {!commits || commits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No commits.</p>
          ) : (
            <div className="space-y-1">
              {commits.map((commit) => (
                <div key={commit.hash}>
                  <div
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-accent/50 cursor-pointer text-sm"
                    onClick={() => handleToggleCommit(commit.hash)}
                  >
                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                      {commit.hash.substring(0, 7)}
                    </span>
                    <span className="flex-1 truncate">{commit.subject}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {new Date(commit.date).toLocaleDateString()}
                    </span>
                  </div>
                  {expandedCommit === commit.hash && (
                    <div className="ml-2 mb-2">
                      {commitDiffs[commit.hash] ? (
                        <DiffBlock diff={commitDiffs[commit.hash]} />
                      ) : (
                        <p className="text-xs text-muted-foreground p-2">Loading diff...</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
