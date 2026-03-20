import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, ArrowDown, ChevronsUpDown, Search, WrapText, AlignLeft } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { InlineError } from '../InlineError';
import { formatRelativeTimestamp, buildPipelineMap } from './task-helpers';
import { useTasks } from '../../hooks/useTasks';
import { usePipelines } from '../../hooks/usePipelines';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { getEffectiveCost, formatCost } from '../../../shared/cost-utils';
import type { Pipeline, TaskFilter, AgentRun } from '../../../shared/types';

type TableSortField = 'title' | 'status' | 'type' | 'subtasks' | 'createdBy' | 'runs' | 'failed' | 'cost' | 'created' | 'updated';

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

interface SortableHeaderProps {
  field: TableSortField;
  label: string;
  current: TableSortField;
  direction: 'asc' | 'desc';
  onSort: (field: TableSortField) => void;
  className?: string;
}

function SortableHeader({ field, label, current, direction, onSort, className = '' }: SortableHeaderProps) {
  const isActive = current === field;
  return (
    <th
      className={`px-3 py-2 text-left font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors ${className}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive ? (
          direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 opacity-30" />
        )}
      </span>
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
  const [expandTitle, setExpandTitle] = useState(false);
  const [sortField, setSortField] = useLocalStorage<TableSortField>('taskTable.sortField', 'updated');
  const [sortDir, setSortDir] = useLocalStorage<'asc' | 'desc'>('taskTable.sortDir', 'desc');

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
          <button
            type="button"
            onClick={() => setExpandTitle((v) => !v)}
            className={`h-8 px-2 rounded-md border text-xs transition-colors ${expandTitle ? 'bg-accent text-foreground border-border' : 'bg-background text-muted-foreground border-input hover:bg-accent/50'}`}
            title={expandTitle ? 'Compact titles' : 'Expand titles'}
          >
            {expandTitle ? <AlignLeft className="w-3.5 h-3.5" /> : <WrapText className="w-3.5 h-3.5" />}
          </button>
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
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b bg-muted/30">
                  <SortableHeader field="title" label="Title" current={sortField} direction={sortDir} onSort={handleSort} />
                  <SortableHeader field="created" label="Created" current={sortField} direction={sortDir} onSort={handleSort} />
                  <SortableHeader field="updated" label="Updated" current={sortField} direction={sortDir} onSort={handleSort} />
                  <SortableHeader field="status" label="Status" current={sortField} direction={sortDir} onSort={handleSort} />
                  <SortableHeader field="type" label="Type" current={sortField} direction={sortDir} onSort={handleSort} />
                  <SortableHeader field="subtasks" label="Subtasks" current={sortField} direction={sortDir} onSort={handleSort} />
                  <SortableHeader field="createdBy" label="Created By" current={sortField} direction={sortDir} onSort={handleSort} />
                  <SortableHeader field="runs" label="Runs" current={sortField} direction={sortDir} onSort={handleSort} />
                  <SortableHeader field="failed" label="Failed" current={sortField} direction={sortDir} onSort={handleSort} />
                  <SortableHeader field="cost" label="Cost" current={sortField} direction={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedTasks.map((task) => {
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
                      <td className={`px-3 py-2 font-medium ${expandTitle ? '' : 'max-w-[300px]'}`}>
                        <span className={expandTitle ? 'whitespace-normal' : 'truncate block'}>{task.title}</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatRelativeTimestamp(task.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {formatRelativeTimestamp(task.updatedAt)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/40"
                            style={statusColor ? { backgroundColor: statusColor } : undefined}
                          />
                          <span className="text-muted-foreground">{task.status}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap capitalize">
                        {task.type ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {task.subtasks.length > 0
                          ? <span>{doneSubtasks}/{task.subtasks.length}</span>
                          : <span className="text-muted-foreground/50">-</span>
                        }
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {task.createdBy ?? '-'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {runsLoading ? <span className="text-muted-foreground/40">...</span> : (stats.runs || '-')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {runsLoading ? <span className="text-muted-foreground/40">...</span> : stats.failed > 0
                          ? <span className="text-red-500">{stats.failed}</span>
                          : <span className="text-muted-foreground/50">-</span>
                        }
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {runsLoading ? <span className="text-muted-foreground/40">...</span> : stats.cost > 0 ? formatCost(stats.cost) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
