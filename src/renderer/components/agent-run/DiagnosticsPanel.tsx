import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { InlineError } from '../InlineError';
import { reportError } from '../../lib/error-handler';
import type { AgentRun, RunDiagnostics } from '../../../shared/types';

interface DiagnosticsPanelProps {
  run: AgentRun;
  onDiagnosticsComputed: () => void;
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

function shortPath(p: string): string {
  const parts = p.split('/');
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : p;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="py-2">
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function DiagnosticsContent({ d }: { d: RunDiagnostics }) {
  const { subagentSec, directToolSec, thinkingSec } = d.timeBreakdown;
  const accountedSec = subagentSec + directToolSec + thinkingSec;
  const otherSec = Math.max(0, d.wallTimeSec - accountedSec);

  // Top tools by count
  const topTools = Object.entries(d.toolCalls.byTool)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Duplicate file reads
  const dupEntries = Object.entries(d.fileReads.duplicates)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-4 space-y-4">
      {/* Overview stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <StatCard label="Wall Time" value={formatDuration(d.wallTimeSec)} />
        <StatCard label="Turns" value={d.turnCount} />
        <StatCard label="Tool Calls" value={d.toolCalls.total} sub={`${d.toolCalls.subagentSpawns} subagent spawn${d.toolCalls.subagentSpawns !== 1 ? 's' : ''}`} />
        <StatCard label="Output" value={d.producedOutput ? 'Yes' : 'No'} sub={d.producedOutput ? 'Structured output produced' : 'Timed out or failed'} />
      </div>

      {/* Time breakdown */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Time Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <TimeBar
            segments={[
              { label: 'Subagents', sec: subagentSec, color: 'bg-red-500' },
              { label: 'Direct Tools', sec: directToolSec, color: 'bg-blue-500' },
              { label: 'Thinking', sec: thinkingSec, color: 'bg-yellow-500' },
              { label: 'Other', sec: otherSec, color: 'bg-gray-300' },
            ]}
            totalSec={d.wallTimeSec}
          />
        </CardContent>
      </Card>

      {/* File reads */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">File Reads</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b">
                <td className="py-2 text-muted-foreground">Total reads</td>
                <td className="py-2 font-mono text-right">{d.fileReads.total}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-muted-foreground">Unique files</td>
                <td className="py-2 font-mono text-right">{d.fileReads.uniqueFiles}</td>
              </tr>
              {d.fileReads.subagentReads > 0 && (
                <tr className="border-b">
                  <td className="py-2 text-muted-foreground">Subagent reads</td>
                  <td className="py-2 font-mono text-right">{d.fileReads.subagentReads}</td>
                </tr>
              )}
            </tbody>
          </table>
          {dupEntries.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium mb-2">Duplicate Reads</p>
              <div className="space-y-1">
                {dupEntries.map(([path, count]) => (
                  <div key={path} className="flex justify-between text-xs font-mono">
                    <span className="truncate mr-2" title={path}>{shortPath(path)}</span>
                    <span className="text-muted-foreground whitespace-nowrap">{count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tool call breakdown */}
      {topTools.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Tool Calls by Type</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="space-y-1">
              {topTools.map(([name, count]) => (
                <div key={name} className="flex justify-between text-sm">
                  <span className="font-mono">{name}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subagent details */}
      {d.subagents.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Subagent Spawns</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <div className="space-y-2">
              {d.subagents.map((sa) => (
                <div key={sa.toolUseId} className="border rounded p-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{formatDuration(sa.durationSec)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{sa.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Context compactions */}
      {d.compactionCount > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Context Compactions</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-sm">
              {d.compactionCount} compaction{d.compactionCount !== 1 ? 's' : ''} detected —
              context window was under pressure during this run.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TimeBar({ segments, totalSec }: { segments: Array<{ label: string; sec: number; color: string }>; totalSec: number }) {
  if (totalSec === 0) return null;
  return (
    <div>
      <div className="flex h-6 rounded overflow-hidden mb-2">
        {segments.map((seg) => {
          const pct = (seg.sec / totalSec) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={seg.label}
              className={`${seg.color} relative group`}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${formatDuration(seg.sec)} (${Math.round(pct)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {segments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1">
            <span className={`inline-block w-3 h-3 rounded ${seg.color}`} />
            {seg.label}: {formatDuration(seg.sec)} ({Math.round((seg.sec / totalSec) * 100)}%)
          </span>
        ))}
      </div>
    </div>
  );
}

export function DiagnosticsPanel({ run, onDiagnosticsComputed }: DiagnosticsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCompute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await window.api.agents.computeDiagnostics(run.id);
      onDiagnosticsComputed();
    } catch (err) {
      reportError(err, 'Compute diagnostics');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [run.id, onDiagnosticsComputed]);

  if (run.status === 'running') {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">Diagnostics will be available after the run completes.</p>
      </div>
    );
  }

  if (!run.diagnostics) {
    return (
      <div className="p-4 flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground">
          No diagnostics available for this run.
        </p>
        {run.messages && run.messages.length > 0 ? (
          <>
            <Button onClick={handleCompute} disabled={loading}>
              {loading ? 'Computing...' : 'Compute Diagnostics'}
            </Button>
            {error && <InlineError message={error} context="Compute diagnostics" />}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No message data available to analyze.</p>
        )}
      </div>
    );
  }

  return <DiagnosticsContent d={run.diagnostics} />;
}
