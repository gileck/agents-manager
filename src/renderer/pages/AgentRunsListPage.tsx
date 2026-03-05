import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { RefreshCw } from 'lucide-react';
import { reportError } from '../lib/error-handler';
import type { AgentRun, AgentRunStatus, Task } from '../../shared/types';

const STATUS_COLORS: Record<AgentRunStatus, string> = {
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  timed_out: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  cancelled: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
};

function StatusBadge({ status }: { status: AgentRunStatus }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${STATUS_COLORS[status] || 'bg-gray-200 text-gray-800'}`}>
      {status}
    </span>
  );
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function formatDuration(startedAt: number, completedAt: number | null): string {
  if (!completedAt) return 'running...';
  const secs = Math.round((completedAt - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

export function AgentRunsListPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [tasks, setTasks] = useState<Map<string, Task>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AgentRunStatus | ''>('');
  const [agentTypeFilter, setAgentTypeFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRuns = useCallback(async () => {
    try {
      const allRuns = await window.api.agents.allRuns();
      // Sort by most recent first
      allRuns.sort((a: AgentRun, b: AgentRun) => b.startedAt - a.startedAt);
      setRuns(allRuns);

      // Fetch task names for display
      const taskIds = [...new Set(allRuns.map((r: AgentRun) => r.taskId))];
      const taskMap = new Map<string, Task>();
      await Promise.all(
        taskIds.map(async (id) => {
          try {
            const task = await window.api.tasks.get(id);
            if (task) taskMap.set(id, task);
          } catch { /* task may be deleted */ }
        }),
      );
      setTasks(taskMap);
    } catch (err) {
      reportError(err, 'Fetch agent runs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchRuns, 5000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchRuns]);

  // Derive unique agent types for filter dropdown
  const agentTypes = [...new Set(runs.map((r) => r.agentType))].sort();

  const filtered = runs.filter((r) => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (agentTypeFilter && r.agentType !== agentTypeFilter) return false;
    return true;
  });

  // Stats
  const totalRuns = runs.length;
  const failedCount = runs.filter((r) => r.status === 'failed').length;
  const runningCount = runs.filter((r) => r.status === 'running').length;
  const completedCount = runs.filter((r) => r.status === 'completed').length;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agent Runs</h1>
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
          <Button variant="outline" size="sm" onClick={fetchRuns} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-4 text-sm">
        <span className="text-muted-foreground">Total: <strong>{totalRuns}</strong></span>
        {runningCount > 0 && <span className="text-blue-600 dark:text-blue-400">Running: <strong>{runningCount}</strong></span>}
        <span className="text-green-600 dark:text-green-400">Completed: <strong>{completedCount}</strong></span>
        {failedCount > 0 && <span className="text-red-600 dark:text-red-400">Failed: <strong>{failedCount}</strong></span>}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <select
          className="border rounded px-2 py-1 text-sm bg-background"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AgentRunStatus | '')}
        >
          <option value="">All Statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="timed_out">Timed Out</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          className="border rounded px-2 py-1 text-sm bg-background"
          value={agentTypeFilter}
          onChange={(e) => setAgentTypeFilter(e.target.value)}
        >
          <option value="">All Agent Types</option>
          {agentTypes.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          Showing {filtered.length} of {totalRuns} runs
        </span>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Agent Type</th>
                  <th className="px-4 py-2 font-medium">Task</th>
                  <th className="px-4 py-2 font-medium">Mode</th>
                  <th className="px-4 py-2 font-medium">Started</th>
                  <th className="px-4 py-2 font-medium">Duration</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      {loading ? 'Loading...' : 'No agent runs found'}
                    </td>
                  </tr>
                )}
                {filtered.map((run) => {
                  const task = tasks.get(run.taskId);
                  const isError = run.status === 'failed' || run.status === 'timed_out';
                  return (
                    <tr
                      key={run.id}
                      className={`border-b cursor-pointer transition-colors hover:bg-muted/50 ${isError ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`}
                      onClick={() => navigate(`/agents/${run.id}`)}
                    >
                      <td className="px-4 py-2">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{run.agentType}</td>
                      <td className="px-4 py-2 max-w-[250px] truncate" title={task?.title || run.taskId}>
                        {task?.title || <span className="text-muted-foreground">{run.taskId.slice(0, 8)}...</span>}
                      </td>
                      <td className="px-4 py-2 text-xs">{run.mode}</td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">{formatTime(run.startedAt)}</td>
                      <td className="px-4 py-2 text-xs whitespace-nowrap">{formatDuration(run.startedAt, run.completedAt)}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{run.model || '-'}</td>
                      <td className="px-4 py-2 max-w-[300px]">
                        {run.error ? (
                          <span className="text-xs text-red-600 dark:text-red-400 truncate block" title={run.error}>
                            {run.error.length > 80 ? run.error.slice(0, 80) + '...' : run.error}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
