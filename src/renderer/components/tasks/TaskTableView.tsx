import React, { useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, ChevronsUpDown, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { InlineError } from '../InlineError';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { formatRelativeTimestamp, buildPipelineMap, groupTasks, sortGroupEntries } from './task-helpers';
import type { GroupBy } from './task-helpers';
import { useTasks } from '../../hooks/useTasks';
import { usePipelines } from '../../hooks/usePipelines';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { getEffectiveCost, formatCost } from '../../../shared/cost-utils';
import type { Pipeline, TaskFilter, AgentRun } from '../../../shared/types';

type TableSortField = 'title' | 'status' | 'type' | 'subtasks' | 'createdBy' | 'runs' | 'failed' | 'cost' | 'created' | 'updated';
type TableGroupBy = Extract<GroupBy, 'none' | 'status' | 'type' | 'createdDate'>;

const GROUP_BY_OPTIONS: { value: TableGroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'createdDate', label: 'Created Date' },
  { value: 'status', label: 'Status' },
  { value: 'type', label: 'Type' },
];

const COLUMNS: { field: TableSortField; label: string; defaultWidth: number; minWidth: number }[] = [
  { field: 'title',     label: 'Title',      defaultWidth: 250, minWidth: 100 },
  { field: 'created',   label: 'Created',    defaultWidth: 110, minWidth: 95 },
  { field: 'updated',   label: 'Updated',    defaultWidth: 110, minWidth: 95 },
  { field: 'status',    label: 'Status',     defaultWidth: 120, minWidth: 90 },
  { field: 'type',      label: 'Type',       defaultWidth: 90,  minWidth: 75 },
  { field: 'subtasks',  label: 'Subtasks',   defaultWidth: 100, minWidth: 95 },
  { field: 'createdBy', label: 'Created By', defaultWidth: 120, minWidth: 110 },
  { field: 'runs',      label: 'Runs',       defaultWidth: 75,  minWidth: 70 },
  { field: 'failed',    label: 'Failed',     defaultWidth: 80,  minWidth: 75 },
  { field: 'cost',      label: 'Cost',       defaultWidth: 80,  minWidth: 70 },
];

const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.field, c.defaultWidth]),
);

const MIN_WIDTHS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.field, c.minWidth]),
);

const NAMED_COLOR_CSS: Record<string, string> = {
  blue: '#3b82f6',
  gray: '#6b7280',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
};

function getStatusDotColor(status: string, pipeline: Pipeline | null): string | undefined {
  if (!pipeline) return undefined;
  const statusDef = pipeline.statuses.find((s) => s.name === status);
  if (!statusDef?.color) return undefined;
  const color = statusDef.color;
  if (color.startsWith('#')) return color;
  return NAMED_COLOR_CSS[color];
}

interface TaskRunStats {
  runs: number;
  failed: number;
  cost: number;
}

function buildRunStatsMap(allRuns: AgentRun[]): Map<string, TaskRunStats> {
  const map = new Map<string, TaskRunStats>();
  for (const run of allRuns) {
    const existing = map.get(run.taskId) ?? { runs: 0, failed: 0, cost: 0 };
    existing.runs++;
    if (run.status === 'failed' || run.status === 'timed_out') {
      existing.failed++;
    }
    existing.cost += getEffectiveCost({
      totalCostUsd: run.totalCostUsd,
      inputTokens: run.costInputTokens,
      outputTokens: run.costOutputTokens,
      cacheReadTokens: run.cacheReadInputTokens,
      cacheWriteTokens: run.cacheCreationInputTokens,
      model: run.model ?? undefined,
    });
    map.set(run.taskId, existing);
  }
  return map;
}

interface ResizableHeaderProps {
  field: TableSortField;
  label: string;
  width: number;
  sortField: TableSortField;
  sortDir: 'asc' | 'desc';
  onSort: (field: TableSortField) => void;
  onResize: (field: string, width: number) => void;
}

function ResizableHeader({ field, label, width, sortField, sortDir, onSort, onResize }: ResizableHeaderProps) {
  const isActive = sortField === field;
  const dragRef = useRef({ startX: 0, startWidth: 0, dragging: false });

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startWidth: width, dragging: true };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragRef.current.dragging) return;
      const delta = moveEvent.clientX - dragRef.current.startX;
      const newWidth = Math.max(MIN_WIDTHS[field] ?? 50, dragRef.current.startWidth + delta);
      onResize(field, newWidth);
    };

    const handleMouseUp = () => {
      dragRef.current.dragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [field, width, onResize]);

  return (
    <th
      className="relative px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap"
      style={{ width, minWidth: MIN_WIDTHS[field] ?? 50 }}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 opacity-30" />
        )}
      </span>
      <div
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
        onMouseDown={handleResizeStart}
        onClick={(e) => e.stopPropagation()}
      />
    </th>
  );
}

export function TaskTableView() {
  const { currentProjectId, loading: projectLoading } = useCurrentProject();
  const navigate = useNavigate();

  const taskFilter: TaskFilter = {};
  if (currentProjectId) taskFilter.projectId = currentProjectId;

  const { tasks, loading, error } = useTasks(taskFilter);
  const { pipelines, loading: pipelinesLoading, error: pipelinesError } = usePipelines();
  const pipelineMap = useMemo(() => buildPipelineMap(pipelines), [pipelines]);

  // Fetch all agent runs for stats
  const { data: allRuns, loading: runsLoading, error: runsError } = useIpc<AgentRun[]>(
    () => window.api.agents.allRuns(), [tasks.length],
  );

  const runStatsMap = useMemo(() => buildRunStatsMap(allRuns ?? []), [allRuns]);

  const [search, setSearch] = useState('');
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS);
  const [sortField, setSortField] = useLocalStorage<TableSortField>('taskTable.sortField', 'updated');
  const [sortDir, setSortDir] = useLocalStorage<'asc' | 'desc'>('taskTable.sortDir', 'desc');
  const [groupBy, setGroupBy] = useLocalStorage<TableGroupBy>('taskTable.groupBy', 'none');
  const [collapsedArray, setCollapsedArray] = useLocalStorage<string[]>('taskTable.collapsedGroups', []);

  const collapsed = useMemo(() => new Set(collapsedArray), [collapsedArray]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedArray((prev) => {
      const set = new Set(prev);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return Array.from(set);
    });
  }, [setCollapsedArray]);

  const handleColumnResize = useCallback((field: string, width: number) => {
    setColumnWidths((prev) => ({ ...prev, [field]: width }));
  }, []);

  const tableWidth = useMemo(() => {
    return COLUMNS.reduce((sum, col) => sum + (columnWidths[col.field] ?? col.defaultWidth), 0);
  }, [columnWidths]);

  const filteredTasks = useMemo(() => {
    if (!search.trim()) return tasks;
    const q = search.toLowerCase();
    return tasks.filter((t) =>
      t.title.toLowerCase().includes(q)
      || t.status.toLowerCase().includes(q)
      || (t.type ?? '').toLowerCase().includes(q)
      || (t.createdBy ?? '').toLowerCase().includes(q)
      || (t.assignee ?? '').toLowerCase().includes(q)
      || t.tags.some((tag) => tag.toLowerCase().includes(q))
    );
  }, [tasks, search]);

  const handleSort = (field: TableSortField) => {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'title' || field === 'type' || field === 'createdBy' ? 'asc' : 'desc');
    }
  };

  const sortedTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      let cmp: number;
      const statsA = runStatsMap.get(a.id) ?? { runs: 0, failed: 0, cost: 0 };
      const statsB = runStatsMap.get(b.id) ?? { runs: 0, failed: 0, cost: 0 };
      const subtasksA = a.subtasks.filter((s) => s.status === 'done').length;
      const subtasksB = b.subtasks.filter((s) => s.status === 'done').length;

      switch (sortField) {
        case 'title': cmp = a.title.localeCompare(b.title); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'type': cmp = (a.type ?? '').localeCompare(b.type ?? ''); break;
        case 'subtasks': cmp = subtasksA - subtasksB || a.subtasks.length - b.subtasks.length; break;
        case 'createdBy': cmp = (a.createdBy ?? '').localeCompare(b.createdBy ?? ''); break;
        case 'runs': cmp = statsA.runs - statsB.runs; break;
        case 'failed': cmp = statsA.failed - statsB.failed; break;
        case 'cost': cmp = statsA.cost - statsB.cost; break;
        case 'created': cmp = a.createdAt - b.createdAt; break;
        case 'updated':
        default: cmp = a.updatedAt - b.updatedAt; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredTasks, sortField, sortDir, runStatsMap]);

  const groups = useMemo(() => {
    if (groupBy === 'none') return null;
    return sortGroupEntries(groupTasks(sortedTasks, groupBy, pipelineMap), groupBy, pipelineMap);
  }, [sortedTasks, groupBy, pipelineMap]);

  if (projectLoading || loading || pipelinesLoading) {
    return <div className="p-8"><p className="text-muted-foreground">Loading tasks...</p></div>;
  }
  if (error || pipelinesError) {
    return <div className="p-8"><InlineError message={(error || pipelinesError)!} context="Tasks" /></div>;
  }
  if (!currentProjectId) {
    return (
      <div className="p-8">
        <Card><CardContent className="py-8 text-center">
          <p className="text-muted-foreground">No project selected. Go to Projects to select one.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-8 pb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-56 rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Group:</span>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as TableGroupBy)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_BY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            {sortedTasks.length} {sortedTasks.length === 1 ? 'task' : 'tasks'}
            {search && sortedTasks.length !== tasks.length && ` of ${tasks.length}`}
          </p>
          {runsError && <p className="text-xs text-destructive">Failed to load agent run stats</p>}
        </div>

        {sortedTasks.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">No tasks found.</p>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="text-sm" style={{ width: tableWidth, tableLayout: 'fixed' }}>
              <thead>
                <tr className="border-b bg-muted/30">
                  {COLUMNS.map((col) => (
                    <ResizableHeader
                      key={col.field}
                      field={col.field}
                      label={col.label}
                      width={columnWidths[col.field] ?? col.defaultWidth}
                      sortField={sortField}
                      sortDir={sortDir}
                      onSort={handleSort}
                      onResize={handleColumnResize}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups ? (
                  Array.from(groups.entries()).map(([groupKey, groupTasks_]) => {
                    const isCollapsed = collapsed.has(groupKey);
                    // For status groups, resolve the dot color from the first pipeline
                    const statusDotColor = groupBy === 'status'
                      ? getStatusDotColor(groupKey, pipelineMap.values().next().value ?? null)
                      : undefined;

                    return (
                      <React.Fragment key={groupKey}>
                        <tr
                          className="bg-muted/40 border-b border-border/40 cursor-pointer select-none hover:bg-muted/60 transition-colors"
                          onClick={() => toggleGroup(groupKey)}
                        >
                          <td colSpan={COLUMNS.length} className="px-3 py-1.5">
                            <span className="inline-flex items-center gap-2 text-sm font-medium">
                              {isCollapsed
                                ? <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                : <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              }
                              {statusDotColor && (
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={{ backgroundColor: statusDotColor }}
                                />
                              )}
                              <span>{groupKey}</span>
                              <span className="text-xs text-muted-foreground font-normal">
                                ({groupTasks_.length})
                              </span>
                            </span>
                          </td>
                        </tr>
                        {!isCollapsed && groupTasks_.map((task) => {
                          const pipeline = pipelineMap.get(task.pipelineId) ?? null;
                          const statusColor = getStatusDotColor(task.status, pipeline);
                          const stats = runStatsMap.get(task.id) ?? { runs: 0, failed: 0, cost: 0 };
                          const doneSubtasks = task.subtasks.filter((s) => s.status === 'done').length;

                          return (
                            <tr
                              key={task.id}
                              className="border-b border-border/40 last:border-b-0 hover:bg-accent/40 cursor-pointer transition-colors"
                              onClick={() => navigate(`/tasks/${task.id}`)}
                            >
                              <td className="px-3 py-2 font-medium overflow-hidden">
                                <span className="block truncate">{task.title}</span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                                {formatRelativeTimestamp(task.createdAt)}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                                {formatRelativeTimestamp(task.updatedAt)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap overflow-hidden">
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/40"
                                    style={statusColor ? { backgroundColor: statusColor } : undefined}
                                  />
                                  <span className="text-muted-foreground">{task.status}</span>
                                </span>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden capitalize">
                                {task.type ?? '-'}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                                {task.subtasks.length > 0
                                  ? <span>{doneSubtasks}/{task.subtasks.length}</span>
                                  : <span className="text-muted-foreground/50">-</span>
                                }
                              </td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                                {task.createdBy ?? '-'}
                              </td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                                {runsLoading ? <span className="text-muted-foreground/40">...</span> : (stats.runs || '-')}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap overflow-hidden">
                                {runsLoading ? <span className="text-muted-foreground/40">...</span> : stats.failed > 0
                                  ? <span className="text-red-500">{stats.failed}</span>
                                  : <span className="text-muted-foreground/50">-</span>
                                }
                              </td>
                              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                                {runsLoading ? <span className="text-muted-foreground/40">...</span> : stats.cost > 0 ? formatCost(stats.cost) : '-'}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })
                ) : (
                  sortedTasks.map((task) => {
                    const pipeline = pipelineMap.get(task.pipelineId) ?? null;
                    const statusColor = getStatusDotColor(task.status, pipeline);
                    const stats = runStatsMap.get(task.id) ?? { runs: 0, failed: 0, cost: 0 };
                    const doneSubtasks = task.subtasks.filter((s) => s.status === 'done').length;

                    return (
                      <tr
                        key={task.id}
                        className="border-b border-border/40 last:border-b-0 hover:bg-accent/40 cursor-pointer transition-colors"
                        onClick={() => navigate(`/tasks/${task.id}`)}
                      >
                        <td className="px-3 py-2 font-medium overflow-hidden">
                          <span className="block truncate">{task.title}</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                          {formatRelativeTimestamp(task.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                          {formatRelativeTimestamp(task.updatedAt)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap overflow-hidden">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/40"
                              style={statusColor ? { backgroundColor: statusColor } : undefined}
                            />
                            <span className="text-muted-foreground">{task.status}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden capitalize">
                          {task.type ?? '-'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                          {task.subtasks.length > 0
                            ? <span>{doneSubtasks}/{task.subtasks.length}</span>
                            : <span className="text-muted-foreground/50">-</span>
                          }
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                          {task.createdBy ?? '-'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                          {runsLoading ? <span className="text-muted-foreground/40">...</span> : (stats.runs || '-')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap overflow-hidden">
                          {runsLoading ? <span className="text-muted-foreground/40">...</span> : stats.failed > 0
                            ? <span className="text-red-500">{stats.failed}</span>
                            : <span className="text-muted-foreground/50">-</span>
                          }
                        </td>
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap overflow-hidden">
                          {runsLoading ? <span className="text-muted-foreground/40">...</span> : stats.cost > 0 ? formatCost(stats.cost) : '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
