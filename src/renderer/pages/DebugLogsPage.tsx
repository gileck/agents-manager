import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import type { AppDebugLogEntry, AppDebugLogFilter, AppLogLevel } from '../../shared/types';
import { RefreshCw, Trash2, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { reportError } from '../lib/error-handler';

const LEVEL_COLORS: Record<AppLogLevel, string> = {
  debug: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  warn: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

function LevelBadge({ level }: { level: AppLogLevel }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${LEVEL_COLORS[level]}`}>
      {level}
    </span>
  );
}

function DataCell({ data }: { data: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = Object.keys(data).length > 0;

  if (!hasData) return <span className="text-muted-foreground">-</span>;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {Object.keys(data).length} key(s)
      </button>
      {expanded && (
        <pre className="mt-1 text-xs bg-muted p-2 rounded overflow-x-auto max-w-md">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function DebugLogsPage() {
  const [entries, setEntries] = useState<AppDebugLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [levelFilter, setLevelFilter] = useState<AppLogLevel | ''>('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      setError(null);
      const filter: AppDebugLogFilter = { limit: 200 };
      if (levelFilter) filter.level = levelFilter;
      if (sourceFilter) filter.source = sourceFilter;
      if (searchFilter) filter.search = searchFilter;
      const result = await window.api.debugLogs.list(filter);
      setEntries(result);
    } catch (err) {
      reportError(err, 'Fetch debug logs');
      setError('Failed to fetch debug logs. Is the daemon running?');
    } finally {
      setLoading(false);
    }
  }, [levelFilter, sourceFilter, searchFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchLogs, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchLogs]);

  const handleClear = async () => {
    try {
      await window.api.debugLogs.clear();
      setEntries([]);
      setError(null);
    } catch (err) {
      reportError(err, 'Clear debug logs');
      setError('Failed to clear debug logs.');
    }
  };

  const handleCopyAll = () => {
    const text = entries.map(e =>
      `[${new Date(e.createdAt).toISOString()}] [${e.level}] [${e.source}] ${e.message}${Object.keys(e.data).length > 0 ? ' ' + JSON.stringify(e.data) : ''}`
    ).join('\n');
    navigator.clipboard.writeText(text).catch(err =>
      reportError(err, 'Copy to clipboard'));
  };

  const handleCopyRow = (entry: AppDebugLogEntry) => {
    const text = `[${new Date(entry.createdAt).toISOString()}] [${entry.level}] [${entry.source}] ${entry.message}${Object.keys(entry.data).length > 0 ? ' ' + JSON.stringify(entry.data) : ''}`;
    navigator.clipboard.writeText(text).catch(err =>
      reportError(err, 'Copy to clipboard'));
  };

  return (
    <div className="p-6 space-y-4 max-w-7xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Debug Logs</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as AppLogLevel | '')}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">All Levels</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
            </select>
            <input
              type="text"
              placeholder="Source..."
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              style={{ width: 150 }}
            />
            <input
              type="text"
              placeholder="Search message..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              style={{ width: 200 }}
            />
            <div className="flex-1" />
            <Button variant="outline" size="sm" onClick={fetchLogs} title="Refresh">
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopyAll} title="Copy all logs">
              <Copy className="h-3.5 w-3.5 mr-1" />
              Copy All
            </Button>
            <Button variant="outline" size="sm" onClick={handleClear} title="Clear all logs">
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-300 px-4 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">
            {loading ? 'Loading...' : `${entries.length} log entries`}
          </CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          {entries.length === 0 && !loading ? (
            <p className="py-4 text-sm text-muted-foreground">No log entries found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3" style={{ width: 170 }}>Timestamp</th>
                    <th className="py-2 pr-3" style={{ width: 60 }}>Level</th>
                    <th className="py-2 pr-3" style={{ width: 120 }}>Source</th>
                    <th className="py-2 pr-3">Message</th>
                    <th className="py-2 pr-3" style={{ width: 100 }}>Data</th>
                    <th className="py-2" style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3">
                        <LevelBadge level={entry.level} />
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{entry.source}</td>
                      <td className="py-2 pr-3 break-all">{entry.message}</td>
                      <td className="py-2 pr-3">
                        <DataCell data={entry.data} />
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => handleCopyRow(entry)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Copy"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
