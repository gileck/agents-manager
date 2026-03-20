import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, ChevronDown, ChevronLeft } from 'lucide-react';
import { reportError } from '../lib/error-handler';
import { getEffectiveCost, formatCost, formatTokens } from '../../shared/cost-utils';
import type { AgentRun, AgentRunStatus, Task } from '../../shared/types';

// ── Helpers ──

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

function getDurationSeconds(startedAt: number, completedAt: number | null): number {
  const end = completedAt ?? Date.now();
  return Math.round((end - startedAt) / 1000);
}

function formatDuration(secs: number, isRunning: boolean): string {
  const suffix = isRunning ? '...' : '';
  if (secs < 60) return `${secs}s${suffix}`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s${suffix}`;
}

function getRunCost(run: AgentRun): number {
  return getEffectiveCost({
    totalCostUsd: run.totalCostUsd,
    inputTokens: run.costInputTokens,
    outputTokens: run.costOutputTokens,
    cacheReadTokens: run.cacheReadInputTokens,
    cacheWriteTokens: run.cacheCreationInputTokens,
    model: run.model || undefined,
  });
}

function getTotalTokens(run: AgentRun): number {
  return (run.costInputTokens || 0) + (run.costOutputTokens || 0);
}

// ── Sort types ──

type SortField = 'status' | 'agentType' | 'task' | 'mode' | 'startedAt' | 'duration' | 'model' | 'engine' | 'cost' | 'tokens' | 'messages' | 'error';
type SortDir = 'asc' | 'desc';

const STATUS_ORDER: Record<AgentRunStatus, number> = {
  running: 0, failed: 1, timed_out: 2, cancelled: 3, completed: 4,
};

const COLUMN_COUNT = 13; // expand toggle + 12 data columns
const PAGE_SIZE = 50;

const PLACEHOLDER = <span className="text-muted-foreground">-</span>;

// ── SortableHeader ──

function SortableHeader({ label, field, sortField, sortDir, onSort }: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const isActive = sortField === field;
  return (
    <th
      className="px-4 py-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {label}
        {isActive ? (
          sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </div>
    </th>
  );
}

// ── Collapsible text detail ──

function CollapsibleText({ label, text }: { label: string; text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="border rounded bg-muted/30">
      <button
        className="flex items-center gap-1 w-full px-3 py-1.5 text-xs font-medium text-left hover:bg-muted/50 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {label}
      </button>
      {open && (
        <pre className="px-3 pb-2 text-xs whitespace-pre-wrap break-words max-h-[300px] overflow-auto font-mono">
          {text}
        </pre>
      )}
    </div>
  );
}

// ── Detail field (key-value) ──

function DetailField({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-muted-foreground font-medium min-w-[120px]">{label}:</span>
      <span className="font-mono">{String(value)}</span>
    </div>
  );
}

// ── Expanded detail panel ──

function RunDetailPanel({ run, task }: { run: AgentRun; task: Task | undefined }) {
  const cost = getRunCost(run);
  return (
    <div className="p-4 space-y-3 bg-muted/20">
      {/* Metadata grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1">
        <DetailField label="Run ID" value={run.id} />
        <DetailField label="Task ID" value={run.taskId} />
        <DetailField label="Task" value={task?.title} />
        <DetailField label="Agent Type" value={run.agentType} />
        <DetailField label="Status" value={run.status} />
        <DetailField label="Mode" value={run.mode} />
        <DetailField label="Model" value={run.model} />
        <DetailField label="Engine" value={run.engine} />
        <DetailField label="Exit Code" value={run.exitCode} />
        <DetailField label="Outcome" value={run.outcome} />
        <DetailField label="Session ID" value={run.sessionId} />
        <DetailField label="Automated Agent ID" value={run.automatedAgentId} />
        <DetailField label="Started" value={formatTime(run.startedAt)} />
        <DetailField label="Completed" value={run.completedAt ? formatTime(run.completedAt) : 'running'} />
        <DetailField label="Duration" value={formatDuration(getDurationSeconds(run.startedAt, run.completedAt), run.status === 'running')} />
        <DetailField label="Message Count" value={run.messageCount} />
        <DetailField label="Max Turns" value={run.maxTurns} />
        <DetailField label="Timeout" value={run.timeoutMs ? `${run.timeoutMs}ms` : null} />
        <DetailField label="Cost" value={cost > 0 ? formatCost(cost) : null} />
        <DetailField label="Total Cost (SDK)" value={run.totalCostUsd ? formatCost(run.totalCostUsd) : null} />
        <DetailField label="Input Tokens" value={run.costInputTokens ? formatTokens(run.costInputTokens) : null} />
        <DetailField label="Output Tokens" value={run.costOutputTokens ? formatTokens(run.costOutputTokens) : null} />
        <DetailField label="Cache Read Tokens" value={run.cacheReadInputTokens ? formatTokens(run.cacheReadInputTokens) : null} />
        <DetailField label="Cache Write Tokens" value={run.cacheCreationInputTokens ? formatTokens(run.cacheCreationInputTokens) : null} />
      </div>

      {/* Collapsible text fields */}
      <div className="space-y-2">
        <CollapsibleText label="Prompt" text={run.prompt} />
        <CollapsibleText label="Output" text={run.output} />
        <CollapsibleText label="Error" text={run.error} />
        <CollapsibleText label="Diagnostics" text={run.diagnostics ? JSON.stringify(run.diagnostics, null, 2) : null} />
        <CollapsibleText label="Payload" text={Object.keys(run.payload || {}).length > 0 ? JSON.stringify(run.payload, null, 2) : null} />
      </div>
    </div>
  );
}

// ── Main component ──

export function AgentRunsListPage() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [tasks, setTasks] = useState<Map<string, Task>>(new Map());
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<AgentRunStatus | ''>('');
  const [agentTypeFilter, setAgentTypeFilter] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [sortField, setSortField] = useState<SortField>('startedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const allRuns = await window.api.agents.allRuns();
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

  // Sort toggle handler — reset to first page on sort change
  const handleSort = useCallback((field: SortField) => {
    setPage(0);
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return field;
      }
      setSortDir('desc');
      return field;
    });
  }, []);

  // Derive unique agent types for filter dropdown
  const agentTypes = useMemo(() => [...new Set(runs.map((r) => r.agentType))].sort(), [runs]);

  // Filter — reset to first page when filters change
  const filtered = useMemo(() => {
    setPage(0);
    return runs.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (agentTypeFilter && r.agentType !== agentTypeFilter) return false;
      return true;
    });
  }, [runs, statusFilter, agentTypeFilter]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;

    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'status':
          cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
          break;
        case 'agentType':
          cmp = a.agentType.localeCompare(b.agentType);
          break;
        case 'task': {
          const ta = tasks.get(a.taskId)?.title || a.taskId;
          const tb = tasks.get(b.taskId)?.title || b.taskId;
          cmp = ta.localeCompare(tb);
          break;
        }
        case 'mode':
          cmp = a.mode.localeCompare(b.mode);
          break;
        case 'startedAt':
          cmp = a.startedAt - b.startedAt;
          break;
        case 'duration':
          cmp = getDurationSeconds(a.startedAt, a.completedAt) - getDurationSeconds(b.startedAt, b.completedAt);
          break;
        case 'model':
          cmp = (a.model || '').localeCompare(b.model || '');
          break;
        case 'engine':
          cmp = (a.engine || '').localeCompare(b.engine || '');
          break;
        case 'cost':
          cmp = getRunCost(a) - getRunCost(b);
          break;
        case 'tokens':
          cmp = getTotalTokens(a) - getTotalTokens(b);
          break;
        case 'messages':
          cmp = (a.messageCount || 0) - (b.messageCount || 0);
          break;
        case 'error':
          cmp = (a.error || '').localeCompare(b.error || '');
          break;
      }
      return cmp * dir;
    });
    return arr;
  }, [filtered, sortField, sortDir, tasks]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const paged = useMemo(
    () => sorted.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE),
    [sorted, clampedPage],
  );

  // Stats (single pass)
  const stats = useMemo(() => {
    let failed = 0;
    let running = 0;
    let completed = 0;
    let cost = 0;
    for (const r of runs) {
      if (r.status === 'failed') failed++;
      else if (r.status === 'running') running++;
      else if (r.status === 'completed') completed++;
      cost += getRunCost(r);
    }
    return { total: runs.length, failed, running, completed, cost };
  }, [runs]);

  const headerProps = { sortField, sortDir, onSort: handleSort };

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
      <div className="flex gap-4 text-sm flex-wrap">
        <span className="text-muted-foreground">Total: <strong>{stats.total}</strong></span>
        {stats.running > 0 && <span className="text-blue-600 dark:text-blue-400">Running: <strong>{stats.running}</strong></span>}
        <span className="text-green-600 dark:text-green-400">Completed: <strong>{stats.completed}</strong></span>
        {stats.failed > 0 && <span className="text-red-600 dark:text-red-400">Failed: <strong>{stats.failed}</strong></span>}
        <span className="text-muted-foreground">Total Cost: <strong>{formatCost(stats.cost)}</strong></span>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
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
          Showing {clampedPage * PAGE_SIZE + 1}–{Math.min((clampedPage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length} runs
          {sorted.length !== stats.total && ` (${stats.total} total)`}
        </span>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">All Runs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '1500px' }}>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-2 w-8" />
                  <SortableHeader label="Status" field="status" {...headerProps} />
                  <SortableHeader label="Agent Type" field="agentType" {...headerProps} />
                  <SortableHeader label="Task" field="task" {...headerProps} />
                  <SortableHeader label="Mode" field="mode" {...headerProps} />
                  <SortableHeader label="Started" field="startedAt" {...headerProps} />
                  <SortableHeader label="Duration" field="duration" {...headerProps} />
                  <SortableHeader label="Cost" field="cost" {...headerProps} />
                  <SortableHeader label="Tokens" field="tokens" {...headerProps} />
                  <SortableHeader label="Msgs" field="messages" {...headerProps} />
                  <SortableHeader label="Model" field="model" {...headerProps} />
                  <SortableHeader label="Engine" field="engine" {...headerProps} />
                  <SortableHeader label="Error" field="error" {...headerProps} />
                </tr>
              </thead>
              <tbody>
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={COLUMN_COUNT} className="px-4 py-8 text-center text-muted-foreground">
                      {loading ? 'Loading...' : 'No agent runs found'}
                    </td>
                  </tr>
                )}
                {paged.map((run) => {
                  const task = tasks.get(run.taskId);
                  const isError = run.status === 'failed' || run.status === 'timed_out';
                  const isRunning = run.status === 'running';
                  const isExpanded = expandedIds.has(run.id);
                  const durationSecs = getDurationSeconds(run.startedAt, run.completedAt);
                  const cost = getRunCost(run);
                  const tokens = getTotalTokens(run);
                  return (
                    <Fragment key={run.id}>
                      <tr
                        className={`border-b transition-colors cursor-pointer hover:bg-muted/50 ${isError ? 'bg-red-50/50 dark:bg-red-950/20' : ''}`}
                        onClick={() => navigate(`/agents/${run.id}`)}
                      >
                        <td className="px-2 py-2">
                          <button
                            className="p-0.5 rounded hover:bg-muted transition-colors"
                            onClick={(e) => { e.stopPropagation(); toggleExpanded(run.id); }}
                            title={isExpanded ? 'Collapse details' : 'Expand details'}
                          >
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                          </button>
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{run.agentType}</td>
                        <td className="px-4 py-2 max-w-[250px] truncate whitespace-nowrap" title={task?.title || run.taskId}>
                          {task?.title || <span className="text-muted-foreground">{run.taskId.slice(0, 8)}...</span>}
                        </td>
                        <td className="px-4 py-2 text-xs whitespace-nowrap">{run.mode}</td>
                        <td className="px-4 py-2 text-xs whitespace-nowrap">{formatTime(run.startedAt)}</td>
                        <td className="px-4 py-2 text-xs whitespace-nowrap">
                          {formatDuration(durationSecs, isRunning)}
                        </td>
                        <td className="px-4 py-2 text-xs whitespace-nowrap font-mono">
                          {cost > 0 ? formatCost(cost) : PLACEHOLDER}
                        </td>
                        <td className="px-4 py-2 text-xs whitespace-nowrap font-mono">
                          {tokens > 0 ? formatTokens(tokens) : PLACEHOLDER}
                        </td>
                        <td className="px-4 py-2 text-xs whitespace-nowrap font-mono">
                          {run.messageCount != null ? run.messageCount : PLACEHOLDER}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{run.model || '-'}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{run.engine || '-'}</td>
                        <td className="px-4 py-2 max-w-[250px]">
                          {run.error ? (
                            <span className="text-xs text-red-600 dark:text-red-400 truncate block" title={run.error}>
                              {run.error.length > 60 ? run.error.slice(0, 60) + '...' : run.error}
                            </span>
                          ) : (
                            PLACEHOLDER
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b">
                          <td colSpan={COLUMN_COUNT}>
                            <RunDetailPanel run={run} task={task} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {clampedPage + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(0)}
              disabled={clampedPage === 0}
            >
              First
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={clampedPage === 0}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={clampedPage >= totalPages - 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(totalPages - 1)}
              disabled={clampedPage >= totalPages - 1}
            >
              Last
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
