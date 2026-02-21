import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import type { DebugTimelineEntry } from '../../../shared/types';

const SOURCE_COLORS: Record<string, string> = {
  event: '#6b7280',
  activity: '#3b82f6',
  transition: '#8b5cf6',
  agent: '#22c55e',
  phase: '#06b6d4',
  artifact: '#f97316',
  prompt: '#f59e0b',
  git: '#e44d26',
  github: '#a855f7',
  worktree: '#10b981',
  context: '#14b8a6',
};

const SEVERITY_COLORS: Record<string, string> = {
  debug: '#9ca3af',
  info: '#3b82f6',
  warning: '#f59e0b',
  error: '#ef4444',
};

const ALL_SOURCES = ['event', 'activity', 'transition', 'agent', 'phase', 'artifact', 'prompt', 'git', 'github', 'context'] as const;
const ALL_SEVERITIES = ['debug', 'info', 'warning', 'error'] as const;

function formatTime(ts: number): string {
  if (ts === 0) return '--:--:--.---';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

export function DebuggerPanel({ entries }: { entries: DebugTimelineEntry[] }) {
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set(ALL_SOURCES));
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set(ALL_SEVERITIES));
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [sortNewest, setSortNewest] = useState(true);
  const [copied, setCopied] = useState(false);

  const toggleFilter = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  };

  const filtered = entries.filter(
    (e) => sourceFilter.has(e.source) && severityFilter.has(e.severity)
  );

  const sorted = sortNewest
    ? filtered
    : [...filtered].reverse();

  const handleCopyAll = () => {
    const text = sorted.map((e) => {
      const time = formatTime(e.timestamp);
      const line = `${time} [${e.source}] [${e.severity}] ${e.title}`;
      if (e.data) return `${line}\n${JSON.stringify(e.data, null, 2)}`;
      return line;
    }).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card className="mt-4">
      <CardHeader className="py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">Timeline</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortNewest((v) => !v)}
          >
            {sortNewest ? 'Newest first' : 'Oldest first'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyAll}
            disabled={sorted.length === 0}
          >
            {copied ? 'Copied!' : 'Copy All'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filter bar */}
        <div className="flex flex-wrap gap-1 mb-3">
          {ALL_SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => toggleFilter(sourceFilter, s, setSourceFilter)}
              className="px-2 py-0.5 rounded text-xs font-medium border transition-opacity"
              style={{
                borderColor: SOURCE_COLORS[s],
                color: sourceFilter.has(s) ? '#fff' : SOURCE_COLORS[s],
                backgroundColor: sourceFilter.has(s) ? SOURCE_COLORS[s] : 'transparent',
                opacity: sourceFilter.has(s) ? 1 : 0.5,
              }}
            >
              {s}
            </button>
          ))}
          <span className="mx-1 border-l" />
          {ALL_SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => toggleFilter(severityFilter, s, setSeverityFilter)}
              className="px-2 py-0.5 rounded text-xs font-medium border transition-opacity"
              style={{
                borderColor: SEVERITY_COLORS[s],
                color: severityFilter.has(s) ? '#fff' : SEVERITY_COLORS[s],
                backgroundColor: severityFilter.has(s) ? SEVERITY_COLORS[s] : 'transparent',
                opacity: severityFilter.has(s) ? 1 : 0.5,
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Timeline */}
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No entries match the current filters.</p>
        ) : (
          <div className="space-y-0.5 max-h-[600px] overflow-y-auto">
            {sorted.map((entry) => {
              const stableIdx = entries.indexOf(entry);
              const expanded = expandedIds.has(stableIdx);
              return (
                <div key={stableIdx}>
                  <div
                    className="flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-accent/50 cursor-pointer"
                    onClick={() => {
                      if (!entry.data) return;
                      const next = new Set(expandedIds);
                      if (next.has(stableIdx)) next.delete(stableIdx); else next.add(stableIdx);
                      setExpandedIds(next);
                    }}
                  >
                    <span className="font-mono text-muted-foreground shrink-0 w-[90px]">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span
                      className="px-1.5 py-0 rounded text-[10px] font-semibold shrink-0"
                      style={{ backgroundColor: SOURCE_COLORS[entry.source] ?? '#6b7280', color: '#fff' }}
                    >
                      {entry.source}
                    </span>
                    <span
                      className="inline-block w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: SEVERITY_COLORS[entry.severity] ?? '#9ca3af' }}
                    />
                    <span className="truncate">{entry.title}</span>
                    {entry.data && (
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        {expanded ? '\u25BC' : '\u25B6'}
                      </span>
                    )}
                  </div>
                  {expanded && entry.data && (
                    <pre className="text-[11px] bg-muted p-2 rounded ml-[98px] mr-2 mb-1 overflow-x-auto max-h-[300px] overflow-y-auto">
                      {JSON.stringify(entry.data, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
