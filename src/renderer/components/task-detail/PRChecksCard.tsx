import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import type { PRChecksResult, PRCheckRun } from '../../../shared/types';

interface PRChecksCardProps {
  taskId: string;
}

function checkIcon(check: PRCheckRun): { symbol: string; color: string } {
  if (check.state === 'COMPLETED') {
    if (check.conclusion === 'SUCCESS') return { symbol: '\u2713', color: '#3fb950' };
    if (check.conclusion === 'FAILURE') return { symbol: '\u2717', color: '#f85149' };
    if (check.conclusion === 'SKIPPED' || check.conclusion === 'NEUTRAL' || check.conclusion === 'STALE')
      return { symbol: '\u25CB', color: '#8b949e' };
    if (check.conclusion === 'CANCELLED') return { symbol: '\u25CB', color: '#8b949e' };
    if (check.conclusion === 'TIMED_OUT' || check.conclusion === 'ACTION_REQUIRED')
      return { symbol: '!', color: '#e3b341' };
  }
  // QUEUED, IN_PROGRESS, PENDING, WAITING
  return { symbol: '\u25CF', color: '#e3b341' };
}

function mergeChip(result: PRChecksResult): { label: string; color: string; bg: string } {
  if (result.prState === 'MERGED') return { label: 'Merged', color: '#a371f7', bg: 'rgba(163,113,247,0.15)' };
  if (result.prState === 'CLOSED') return { label: 'Closed', color: '#f85149', bg: 'rgba(248,81,73,0.15)' };
  if (result.mergeable === 'MERGEABLE') return { label: 'No conflicts', color: '#3fb950', bg: 'rgba(63,185,80,0.15)' };
  if (result.mergeable === 'CONFLICTING') return { label: 'Has conflicts', color: '#f85149', bg: 'rgba(248,81,73,0.15)' };
  return { label: 'Checking...', color: '#8b949e', bg: 'rgba(139,148,158,0.15)' };
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function PRChecksCard({ taskId }: PRChecksCardProps) {
  const [result, setResult] = useState<PRChecksResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchChecks = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const data = await window.api.git.prChecks(taskId);
      setResult(data);
    } catch (err) {
      console.error('PRChecksCard: failed to fetch PR checks', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchChecks(false);
  }, [fetchChecks]);

  const handleRefresh = useCallback(() => {
    fetchChecks(true);
  }, [fetchChecks]);

  if (loading) {
    return (
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">PR Checks</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <p className="text-xs text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  // null result without error means no data available (e.g. project path missing) — hide card
  if (!result && !error) return null;

  if (error || !result) {
    return (
      <Card>
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">PR Checks</CardTitle>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh"
              style={{
                background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer',
                padding: '2px 4px', color: 'var(--muted-foreground)', fontSize: 13, lineHeight: 1,
                opacity: refreshing ? 0.5 : 1,
              }}
            >
              ↻
            </button>
          </div>
        </CardHeader>
        <CardContent className="pb-3">
          <p className="text-xs text-muted-foreground">Unable to fetch PR checks.</p>
        </CardContent>
      </Card>
    );
  }

  const chip = mergeChip(result);
  const passed = result.checks.filter(c => c.state === 'COMPLETED' && c.conclusion === 'SUCCESS').length;
  const failed = result.checks.filter(c => c.state === 'COMPLETED' && c.conclusion === 'FAILURE').length;
  const pending = result.checks.filter(c => c.state !== 'COMPLETED').length;

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">PR Checks</CardTitle>
          <div className="flex items-center gap-2">
            {result.fetchedAt && (
              <span className="text-[10px] text-muted-foreground">{formatTime(result.fetchedAt)}</span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh"
              style={{
                background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer',
                padding: '2px 4px', color: 'var(--muted-foreground)', fontSize: 13, lineHeight: 1,
                opacity: refreshing ? 0.5 : 1,
              }}
            >
              ↻
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="space-y-2">
          {/* Merge status chip */}
          <div
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 9999,
              fontSize: 11, fontWeight: 600,
              color: chip.color, backgroundColor: chip.bg,
            }}
          >
            {chip.label}
          </div>

          {/* Summary line */}
          {result.checks.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {passed > 0 && <span style={{ color: '#3fb950' }}>{passed} passed</span>}
              {passed > 0 && (failed > 0 || pending > 0) ? ' · ' : ''}
              {failed > 0 && <span style={{ color: '#f85149' }}>{failed} failed</span>}
              {failed > 0 && pending > 0 ? ' · ' : ''}
              {pending > 0 && <span style={{ color: '#e3b341' }}>{pending} pending</span>}
            </div>
          )}

          {/* Check runs list */}
          {result.checks.length > 0 && (
            <div className="space-y-0.5">
              {result.checks.map((check, i) => {
                const icon = checkIcon(check);
                return (
                  <div key={`${check.name}-${i}`} className="flex items-center gap-1.5 text-xs">
                    <span style={{ color: icon.color, fontWeight: 700, fontSize: 11, width: 14, textAlign: 'center' }}>
                      {icon.symbol}
                    </span>
                    <span className="text-muted-foreground truncate">{check.name}</span>
                  </div>
                );
              })}
            </div>
          )}

          {result.checks.length === 0 && (
            <p className="text-xs text-muted-foreground">No check runs found.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
