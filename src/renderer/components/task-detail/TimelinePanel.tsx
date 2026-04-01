import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { reportError } from '../../lib/error-handler';
import type { DebugTimelineEntry } from '../../../shared/types';

// --- Constants ---

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

const ALL_SOURCES = ['event', 'activity', 'transition', 'agent', 'phase', 'artifact', 'prompt', 'git', 'github', 'worktree', 'context'] as const;
const ALL_SEVERITIES = ['debug', 'info', 'warning', 'error'] as const;

// --- Helpers ---

function formatTime(ts: number): string {
  if (ts === 0) return '--:--:--.---';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

function formatDate(ts: number): string {
  if (ts === 0) return '';
  return new Date(ts).toLocaleString();
}

function formatDataValue(value: unknown, indent: number = 0): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, i) => (i === 0 ? line : ' '.repeat(indent) + line))
    .join('\n');
}

// --- Props ---

interface TimelinePanelProps {
  entries: DebugTimelineEntry[];
  isLive?: boolean;
  showFullPageButton?: boolean;
  taskId?: string;
}

// --- Component ---

export function TimelinePanel({ entries, isLive, showFullPageButton = true, taskId }: TimelinePanelProps) {
  const navigate = useNavigate();

  // Persisted preferences
  const [sortNewest, setSortNewest] = useLocalStorage('timeline.sortNewest', true);
  const [viewMode, setViewMode] = useLocalStorage<'compact' | 'large'>('timeline.viewMode', 'compact');

  // Local UI state
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set(ALL_SOURCES));
  const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set(ALL_SEVERITIES));
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [correlationFilter, setCorrelationFilter] = useState<string | null>(null);

  // Pre-stringify data for search — avoid repeated JSON.stringify in filter
  const stringifiedData = useMemo(
    () => entries.map((e) => (e.data ? JSON.stringify(e.data).toLowerCase() : '')),
    [entries],
  );

  // Filter + search + sort
  const processedEntries = useMemo(() => {
    const lowerSearch = search.toLowerCase().trim();

    const filtered = entries
      .map((entry, idx) => ({ entry, originalIdx: idx }))
      .filter(({ entry, originalIdx }) => {
        if (!sourceFilter.has(entry.source)) return false;
        if (!severityFilter.has(entry.severity)) return false;
        if (errorsOnly && entry.severity !== 'error') return false;
        if (correlationFilter && entry.correlationId !== correlationFilter) return false;
        if (lowerSearch) {
          const titleMatch = entry.title.toLowerCase().includes(lowerSearch);
          const dataMatch = stringifiedData[originalIdx]?.includes(lowerSearch) ?? false;
          if (!titleMatch && !dataMatch) return false;
        }
        return true;
      });

    if (!sortNewest) {
      return [...filtered].reverse();
    }
    return filtered;
  }, [entries, sourceFilter, severityFilter, search, sortNewest, stringifiedData, errorsOnly, correlationFilter]);

  // Toggle helpers
  const toggleFilter = useCallback((set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    setter(next);
  }, []);

  const selectAllSources = useCallback(() => setSourceFilter(new Set(ALL_SOURCES)), []);
  const clearAllSources = useCallback(() => setSourceFilter(new Set()), []);
  const selectAllSeverities = useCallback(() => setSeverityFilter(new Set(ALL_SEVERITIES)), []);
  const clearAllSeverities = useCallback(() => setSeverityFilter(new Set()), []);

  const toggleExpand = useCallback((idx: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  // Copy all filtered entries
  const handleCopyAll = useCallback(() => {
    const text = processedEntries.map(({ entry }) => {
      const time = formatTime(entry.timestamp);
      const line = `${time} [${entry.source}] [${entry.severity}] ${entry.title}`;
      if (entry.data) return `${line}\n${JSON.stringify(entry.data, null, 2)}`;
      return line;
    }).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err) => reportError(err, 'Copy to clipboard'));
  }, [processedEntries]);

  const allSourcesSelected = sourceFilter.size === ALL_SOURCES.length;
  const allSeveritiesSelected = severityFilter.size === ALL_SEVERITIES.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 0 }}>
      {/* --- Toolbar --- */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0 8px',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        {/* Row 1: Search + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: '1 1 200px', maxWidth: 360 }}>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-foreground)' }}
            >
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <Input
              placeholder="Search timeline..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 32, height: 32, fontSize: 13 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
            {/* Live indicator */}
            {isLive && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: 11, color: '#22c55e', fontWeight: 600,
                padding: '3px 8px', borderRadius: 9999,
                backgroundColor: 'rgba(34,197,94,0.1)',
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', backgroundColor: '#22c55e',
                  display: 'inline-block',
                  animation: 'timeline-pulse 1.5s ease-in-out infinite',
                }} />
                Live
              </span>
            )}

            {/* Sort toggle */}
            <Button variant="outline" size="sm" onClick={() => setSortNewest((v) => !v)}
              style={{ fontSize: 12, height: 30, padding: '0 10px' }}>
              {sortNewest ? '\u2193 Newest' : '\u2191 Oldest'}
            </Button>

            {/* View mode toggle */}
            <Button variant="outline" size="sm" onClick={() => setViewMode((v) => v === 'compact' ? 'large' : 'compact')}
              style={{ fontSize: 12, height: 30, padding: '0 10px' }}>
              {viewMode === 'compact' ? 'Compact' : 'Detailed'}
            </Button>

            {/* Errors Only */}
            <Button variant={errorsOnly ? 'default' : 'outline'} size="sm"
              onClick={() => setErrorsOnly((v) => !v)}
              style={{
                fontSize: 12, height: 30, padding: '0 10px',
                ...(errorsOnly ? { backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#fff' } : {}),
              }}>
              Errors Only
            </Button>

            {/* Copy all */}
            <Button variant="outline" size="sm" onClick={handleCopyAll} disabled={processedEntries.length === 0}
              style={{ fontSize: 12, height: 30, padding: '0 10px' }}>
              {copied ? '\u2713 Copied' : 'Copy All'}
            </Button>

            {/* Full page button */}
            {showFullPageButton && taskId && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/tasks/${taskId}/timeline`)}
                style={{ fontSize: 12, height: 30, padding: '0 10px' }}>
                Full Page
              </Button>
            )}
          </div>
        </div>

        {/* Row 2: Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {/* Source filters */}
          <button
            onClick={allSourcesSelected ? clearAllSources : selectAllSources}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors"
            style={{ color: 'var(--muted-foreground)', background: 'none', border: '1px dashed var(--border)', cursor: 'pointer' }}
          >
            {allSourcesSelected ? 'Clear' : 'All'}
          </button>
          {ALL_SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => toggleFilter(sourceFilter, s, setSourceFilter)}
              className="px-2 py-0.5 rounded text-[10px] font-semibold border transition-opacity cursor-pointer"
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

          <span style={{ width: 1, height: 16, backgroundColor: 'var(--border)', margin: '0 4px', flexShrink: 0 }} />

          {/* Severity filters */}
          <button
            onClick={allSeveritiesSelected ? clearAllSeverities : selectAllSeverities}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors"
            style={{ color: 'var(--muted-foreground)', background: 'none', border: '1px dashed var(--border)', cursor: 'pointer' }}
          >
            {allSeveritiesSelected ? 'Clear' : 'All'}
          </button>
          {ALL_SEVERITIES.map((s) => (
            <button
              key={s}
              onClick={() => toggleFilter(severityFilter, s, setSeverityFilter)}
              className="px-2 py-0.5 rounded text-[10px] font-semibold border transition-opacity cursor-pointer"
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

          {/* Result count */}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted-foreground)', flexShrink: 0 }}>
            {processedEntries.length} / {entries.length} entries
          </span>
        </div>
      </div>

      {/* --- Correlation filter banner --- */}
      {correlationFilter && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          backgroundColor: 'rgba(139, 92, 246, 0.1)', borderBottom: '1px solid var(--border)',
          fontSize: 12, flexShrink: 0,
        }}>
          <span style={{ color: 'var(--muted-foreground)' }}>Showing correlation chain:</span>
          <code style={{
            backgroundColor: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6',
            padding: '1px 6px', borderRadius: 3, fontSize: 11, fontFamily: 'monospace',
          }}>
            {correlationFilter.slice(0, 12)}...
          </code>
          <button
            onClick={() => setCorrelationFilter(null)}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 4,
              padding: '1px 8px', fontSize: 10, cursor: 'pointer', color: 'var(--muted-foreground)',
              marginLeft: 'auto',
            }}
            className="hover:bg-accent"
          >
            Clear
          </button>
        </div>
      )}

      {/* --- Entry list --- */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {processedEntries.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '48px 24px', color: 'var(--muted-foreground)', gap: 8,
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            <p style={{ fontSize: 13, textAlign: 'center' }}>
              {entries.length === 0
                ? 'No timeline entries yet. Entries will appear as the task progresses.'
                : 'No entries match the current filters.'}
            </p>
          </div>
        ) : viewMode === 'compact' ? (
          <CompactView entries={processedEntries} expandedIds={expandedIds} onToggleExpand={toggleExpand} onCorrelationClick={setCorrelationFilter} />
        ) : (
          <LargeView entries={processedEntries} expandedIds={expandedIds} onToggleExpand={toggleExpand} onCorrelationClick={setCorrelationFilter} />
        )}
      </div>

    </div>
  );
}

// --- Compact View ---

function CompactView({
  entries,
  expandedIds,
  onToggleExpand,
  onCorrelationClick,
}: {
  entries: { entry: DebugTimelineEntry; originalIdx: number }[];
  expandedIds: Set<number>;
  onToggleExpand: (idx: number) => void;
  onCorrelationClick?: (id: string) => void;
}) {
  return (
    <div style={{ paddingTop: 4 }}>
      {entries.map(({ entry, originalIdx }) => {
        const isExpanded = expandedIds.has(originalIdx);
        return (
          <div key={originalIdx}>
            <div
              onClick={() => onToggleExpand(originalIdx)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                fontSize: 12, padding: '4px 8px', borderRadius: 4,
                cursor: 'pointer',
              }}
              className="hover:bg-accent/50"
            >
              <span style={{ fontFamily: 'monospace', color: 'var(--muted-foreground)', flexShrink: 0, width: 90, fontSize: 11 }}>
                {formatTime(entry.timestamp)}
              </span>
              <span
                style={{
                  backgroundColor: SOURCE_COLORS[entry.source] ?? '#6b7280', color: '#fff',
                  padding: '0 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, flexShrink: 0,
                }}
              >
                {entry.source}
              </span>
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: SEVERITY_COLORS[entry.severity] ?? '#9ca3af',
                }}
              />
              {entry.correlationId && (
                <CorrelationBadge correlationId={entry.correlationId} onClick={onCorrelationClick} />
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {entry.title}
              </span>
              {entry.data && (
                <span style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--muted-foreground)', fontSize: 10 }}>
                  {isExpanded ? '\u25BC' : '\u25B6'}
                </span>
              )}
            </div>
            {isExpanded && <ExpandedDetail entry={entry} onCorrelationClick={onCorrelationClick} />}
          </div>
        );
      })}
    </div>
  );
}

// --- Large / Card View ---

function LargeView({
  entries,
  expandedIds,
  onToggleExpand,
  onCorrelationClick,
}: {
  entries: { entry: DebugTimelineEntry; originalIdx: number }[];
  expandedIds: Set<number>;
  onToggleExpand: (idx: number) => void;
  onCorrelationClick?: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
      {entries.map(({ entry, originalIdx }) => {
        const isExpanded = expandedIds.has(originalIdx);
        return (
          <div
            key={originalIdx}
            style={{
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '10px 12px', cursor: 'pointer',
              backgroundColor: 'var(--card)',
            }}
            className="hover:border-primary/30"
            onClick={() => onToggleExpand(originalIdx)}
          >
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  backgroundColor: SOURCE_COLORS[entry.source] ?? '#6b7280', color: '#fff',
                  padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, flexShrink: 0,
                }}
              >
                {entry.source}
              </span>
              <span
                style={{
                  padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, flexShrink: 0,
                  backgroundColor: SEVERITY_COLORS[entry.severity] ?? '#9ca3af', color: '#fff',
                }}
              >
                {entry.severity}
              </span>
              {entry.correlationId && (
                <CorrelationBadge correlationId={entry.correlationId} onClick={onCorrelationClick} />
              )}
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 11, color: 'var(--muted-foreground)', flexShrink: 0 }}>
                {formatDate(entry.timestamp)}
              </span>
              {entry.data && (
                <span style={{ flexShrink: 0, color: 'var(--muted-foreground)', fontSize: 10 }}>
                  {isExpanded ? '\u25BC' : '\u25B6'}
                </span>
              )}
            </div>

            {/* Title */}
            <p style={{ fontSize: 13, fontWeight: 500, margin: 0, lineHeight: 1.4 }}>
              {entry.title}
            </p>

            {isExpanded && <ExpandedDetail entry={entry} onCorrelationClick={onCorrelationClick} />}
          </div>
        );
      })}
    </div>
  );
}

// --- Expanded Detail View ---

function ExpandedDetail({ entry, onCorrelationClick }: { entry: DebugTimelineEntry; onCorrelationClick?: (id: string) => void }) {
  const [detailCopied, setDetailCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const parts = [
      `Timestamp: ${formatDate(entry.timestamp)}`,
      `Source: ${entry.source}`,
      `Severity: ${entry.severity}`,
      `Title: ${entry.title}`,
    ];
    if (entry.correlationId) {
      parts.push(`CorrelationId: ${entry.correlationId}`);
    }
    if (entry.data) {
      parts.push(`Data:\n${JSON.stringify(entry.data, null, 2)}`);
    }
    navigator.clipboard.writeText(parts.join('\n')).then(() => {
      setDetailCopied(true);
      setTimeout(() => setDetailCopied(false), 2000);
    }).catch((err) => reportError(err, 'Copy to clipboard'));
  }, [entry]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        marginTop: 8, padding: 10, borderRadius: 6,
        backgroundColor: 'var(--muted)', border: '1px solid var(--border)',
        fontSize: 12,
      }}
    >
      {/* Detail metadata */}
      <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '3px 10px', marginBottom: entry.data ? 8 : 0, fontSize: 11 }}>
        <span style={{ color: 'var(--muted-foreground)' }}>Timestamp</span>
        <span style={{ fontFamily: 'monospace' }}>{formatDate(entry.timestamp)}</span>
        <span style={{ color: 'var(--muted-foreground)' }}>Source</span>
        <span style={{ color: SOURCE_COLORS[entry.source] ?? 'var(--foreground)', fontWeight: 600 }}>{entry.source}</span>
        <span style={{ color: 'var(--muted-foreground)' }}>Severity</span>
        <span style={{ color: SEVERITY_COLORS[entry.severity] ?? 'var(--foreground)', fontWeight: 600 }}>{entry.severity}</span>
        {entry.correlationId && (
          <>
            <span style={{ color: 'var(--muted-foreground)' }}>Correlation</span>
            <CorrelationBadge correlationId={entry.correlationId} onClick={onCorrelationClick} />
          </>
        )}
      </div>

      {/* Data */}
      {entry.data && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)' }}>Data</span>
            <button
              onClick={handleCopy}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: 4,
                padding: '1px 8px', fontSize: 10, cursor: 'pointer', color: 'var(--muted-foreground)',
              }}
              className="hover:bg-accent"
            >
              {detailCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre style={{
            fontSize: 11, fontFamily: 'monospace', margin: 0,
            padding: 8, borderRadius: 4,
            backgroundColor: 'var(--background)', border: '1px solid var(--border)',
            overflowX: 'auto', maxHeight: 300, overflowY: 'auto',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {renderDataEntries(entry.data)}
          </pre>
        </div>
      )}
    </div>
  );
}

// --- Correlation Badge ---

function CorrelationBadge({ correlationId, onClick }: { correlationId: string; onClick?: (id: string) => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(correlationId);
      }}
      title={`Filter by correlation: ${correlationId}`}
      style={{
        background: 'rgba(139, 92, 246, 0.12)',
        border: '1px solid rgba(139, 92, 246, 0.3)',
        borderRadius: 3,
        padding: '0 4px',
        fontSize: 9,
        fontFamily: 'monospace',
        color: '#8b5cf6',
        cursor: 'pointer',
        flexShrink: 0,
        lineHeight: '16px',
      }}
      className="hover:bg-accent"
    >
      {correlationId.slice(0, 8)}
    </button>
  );
}

function renderDataEntries(data: Record<string, unknown>): string {
  const entries = Object.entries(data);
  if (entries.length === 0) return '{}';

  return entries.map(([key, value]) => {
    const formatted = formatDataValue(value, key.length + 2);
    return `${key}: ${formatted}`;
  }).join('\n');
}
