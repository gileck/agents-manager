import React, { useState, useMemo } from 'react';
import { Button } from '../ui/button';
import { InlineError } from '../InlineError';
import { Copy, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { reportError } from '../../lib/error-handler';
import { useIpc } from '@template/renderer/hooks/useIpc';
import type { AgentRun, TaskEvent, AppDebugLogEntry } from '../../../shared/types';

interface DebugLogsPanelProps {
  run: AgentRun;
}

interface UnifiedLogEntry {
  id: string;
  timestamp: number;
  source: 'event' | 'debug';
  severity: string;
  category: string;
  message: string;
  data: Record<string, unknown> | null;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; badge: string }> = {
  error:   { bg: '#2d1111', text: '#f87171', badge: '#991b1b' },
  warning: { bg: '#2d2511', text: '#fbbf24', badge: '#92400e' },
  info:    { bg: '#111827', text: '#93c5fd', badge: '#1e3a5f' },
  debug:   { bg: '#111827', text: '#9ca3af', badge: '#374151' },
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
    '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function LogDataView({ data }: { data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs opacity-60 hover:opacity-100 transition-opacity"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {entries.length} field{entries.length !== 1 ? 's' : ''}
      </button>
      {expanded && (
        <div className="mt-1 ml-4 space-y-0.5">
          {entries.map(([key, value]) => (
            <div key={key} className="text-xs font-mono flex gap-2">
              <span className="flex-shrink-0 opacity-70">{key}:</span>
              <span style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DebugLogsPanel({ run }: DebugLogsPanelProps) {
  const [copied, setCopied] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Time window: from run start to run end (or now if still running) with buffer
  const since = run.startedAt - 2000; // 2s before start to catch setup logs
  const until = run.completedAt ? run.completedAt + 2000 : Date.now();

  // Fetch task events for this task in the run's time window
  const { data: taskEvents, loading: eventsLoading, error: eventsError } = useIpc<TaskEvent[]>(
    () => window.api.events.list({ taskId: run.taskId, since, until, limit: 5000 }),
    [run.taskId, run.startedAt, run.completedAt]
  );

  // Fetch app debug logs for the run's time window (filtered by agent source)
  const { data: debugLogs, loading: debugLoading, error: debugError } = useIpc<AppDebugLogEntry[]>(
    () => window.api.debugLogs.list({ since, until, limit: 5000 }),
    [run.startedAt, run.completedAt]
  );

  const fetchError = eventsError || debugError;

  // Merge into unified timeline
  const unifiedLogs = useMemo<UnifiedLogEntry[]>(() => {
    const entries: UnifiedLogEntry[] = [];

    if (taskEvents) {
      for (const evt of taskEvents) {
        entries.push({
          id: `evt-${evt.id}`,
          timestamp: evt.createdAt,
          source: 'event',
          severity: evt.severity,
          category: evt.category,
          message: evt.message,
          data: Object.keys(evt.data).length > 0 ? evt.data : null,
        });
      }
    }

    if (debugLogs) {
      for (const log of debugLogs) {
        // Filter to logs related to this task or agent
        const isRelevant = log.source.startsWith('Agent') ||
          log.source === 'AgentService' ||
          log.source === 'PipelineEngine' ||
          log.source === 'WorkflowService' ||
          (log.data?.taskId === run.taskId) ||
          (log.data?.agentRunId === run.id);
        if (!isRelevant) continue;

        entries.push({
          id: `dbg-${log.id}`,
          timestamp: log.createdAt,
          source: 'debug',
          severity: log.level,
          category: log.source,
          message: log.message,
          data: Object.keys(log.data).length > 0 ? log.data : null,
        });
      }
    }

    entries.sort((a, b) => a.timestamp - b.timestamp);
    return entries;
  }, [taskEvents, debugLogs, run.taskId, run.id]);

  // Get unique categories for filter
  const categories = useMemo(() => {
    const cats = new Set(unifiedLogs.map(l => l.category));
    return Array.from(cats).sort();
  }, [unifiedLogs]);

  // Apply filters
  const filteredLogs = useMemo(() => {
    return unifiedLogs.filter(log => {
      if (severityFilter !== 'all' && log.severity !== severityFilter) return false;
      if (categoryFilter !== 'all' && log.category !== categoryFilter) return false;
      return true;
    });
  }, [unifiedLogs, severityFilter, categoryFilter]);

  const handleCopyAll = () => {
    const text = filteredLogs.map(log => {
      const time = new Date(log.timestamp).toISOString();
      const dataStr = log.data ? ` | ${JSON.stringify(log.data)}` : '';
      return `[${time}] [${log.severity.toUpperCase()}] [${log.category}] ${log.message}${dataStr}`;
    }).join('\n');
    navigator.clipboard.writeText(text).catch((err) => reportError(err, 'Copy logs to clipboard'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const loading = eventsLoading || debugLoading;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0">
        <div className="flex items-center gap-2 text-xs">
          <label className="text-muted-foreground">Severity:</label>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="bg-background border rounded px-1.5 py-0.5 text-xs"
          >
            <option value="all">All</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
            <option value="debug">Debug</option>
          </select>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-muted-foreground">Category:</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-background border rounded px-1.5 py-0.5 text-xs"
          >
            <option value="all">All ({unifiedLogs.length})</option>
            {categories.map(cat => {
              const count = unifiedLogs.filter(l => l.category === cat).length;
              return <option key={cat} value={cat}>{cat} ({count})</option>;
            })}
          </select>
        </div>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          {filteredLogs.length} log{filteredLogs.length !== 1 ? 's' : ''}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyAll}
          className="h-7 px-2 text-xs"
        >
          {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
          {copied ? 'Copied' : 'Copy All Logs'}
        </Button>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {fetchError ? (
          <div className="p-4"><InlineError message={fetchError} context="Debug logs" /></div>
        ) : loading ? (
          <div className="p-4 text-muted-foreground">Loading logs...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-4 text-muted-foreground">No logs found for this agent run.</div>
        ) : (
          <div className="divide-y divide-border/50">
            {filteredLogs.map((log) => {
              const style = SEVERITY_STYLES[log.severity] ?? SEVERITY_STYLES.debug;
              return (
                <div key={log.id} className="px-4 py-1.5 hover:bg-muted/30" style={{ backgroundColor: log.severity === 'error' ? style.bg : undefined }}>
                  <div className="flex items-start gap-2">
                    <span className="flex-shrink-0 opacity-50 tabular-nums" style={{ minWidth: 85 }}>
                      {formatTimestamp(log.timestamp)}
                    </span>
                    <span
                      className="flex-shrink-0 px-1 rounded text-[10px] font-semibold uppercase"
                      style={{ backgroundColor: style.badge, color: style.text, minWidth: 42, textAlign: 'center' }}
                    >
                      {log.severity.slice(0, 4)}
                    </span>
                    <span
                      className="flex-shrink-0 px-1 rounded text-[10px]"
                      style={{ backgroundColor: '#1f2937', color: '#9ca3af', maxWidth: 120 }}
                      title={log.category}
                    >
                      {log.category}
                    </span>
                    <span className="flex-1 min-w-0" style={{ color: style.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {log.message}
                    </span>
                  </div>
                  {log.data && <LogDataView data={log.data} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
