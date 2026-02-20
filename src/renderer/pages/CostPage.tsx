import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { useIpc } from '@template/renderer/hooks/useIpc';
import { calculateCost, formatCost, formatTokens } from '../../shared/cost-utils';
import type { AgentRun, Task } from '../../shared/types';

type TimeGranularity = 'day' | 'week' | 'month';
type TaskSortField = 'cost' | 'inputTokens' | 'outputTokens' | 'runs';
type SortDir = 'asc' | 'desc';

function formatPeriodKey(date: Date, granularity: TimeGranularity): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');

  switch (granularity) {
    case 'day':
      return `${y}-${m}-${d}`;
    case 'week': {
      // ISO week: Monday-based. Find the Monday of the week.
      const day = date.getDay();
      const monday = new Date(date);
      monday.setDate(date.getDate() - ((day + 6) % 7));
      const my = monday.getFullYear();
      const mm = String(monday.getMonth() + 1).padStart(2, '0');
      const md = String(monday.getDate()).padStart(2, '0');
      return `Week of ${my}-${mm}-${md}`;
    }
    case 'month':
      return `${y}-${m}`;
  }
}

export function CostPage() {
  const { data: allRuns, loading: runsLoading } = useIpc<AgentRun[]>(
    () => window.api.agents.allRuns(),
    []
  );

  const { data: tasks, loading: tasksLoading } = useIpc<Task[]>(
    () => window.api.tasks.list(),
    []
  );

  const { data: chatCosts, loading: chatCostsLoading } = useIpc<{ inputTokens: number; outputTokens: number }>(
    () => window.api.chat.costs(),
    []
  );

  const [timeGranularity, setTimeGranularity] = useState<TimeGranularity>('day');
  const [taskSortField, setTaskSortField] = useState<TaskSortField>('cost');
  const [taskSortDir, setTaskSortDir] = useState<SortDir>('desc');

  const runs = allRuns ?? [];
  const taskList = tasks ?? [];

  // Summary (agent runs + chat)
  const summary = useMemo(() => {
    let agentInputTokens = 0;
    let agentOutputTokens = 0;
    for (const run of runs) {
      agentInputTokens += Number(run.costInputTokens) || 0;
      agentOutputTokens += Number(run.costOutputTokens) || 0;
    }
    const chatInput = chatCosts?.inputTokens ?? 0;
    const chatOutput = chatCosts?.outputTokens ?? 0;
    const inputTokens = agentInputTokens + chatInput;
    const outputTokens = agentOutputTokens + chatOutput;
    return {
      inputTokens,
      outputTokens,
      totalCost: calculateCost(inputTokens, outputTokens),
      totalRuns: runs.length,
      chatInputTokens: chatInput,
      chatOutputTokens: chatOutput,
      chatCost: calculateCost(chatInput, chatOutput),
    };
  }, [runs, chatCosts]);

  // Time aggregation
  const timePeriods = useMemo(() => {
    const periodMap = new Map<string, { inputTokens: number; outputTokens: number; runs: number }>();
    for (const run of runs) {
      const date = new Date(run.startedAt);
      const key = formatPeriodKey(date, timeGranularity);
      const existing = periodMap.get(key) ?? { inputTokens: 0, outputTokens: 0, runs: 0 };
      existing.inputTokens += Number(run.costInputTokens) || 0;
      existing.outputTokens += Number(run.costOutputTokens) || 0;
      existing.runs += 1;
      periodMap.set(key, existing);
    }
    // Sort by period key descending (most recent first)
    return Array.from(periodMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([period, data]) => ({
        period,
        ...data,
        cost: calculateCost(data.inputTokens, data.outputTokens),
      }));
  }, [runs, timeGranularity]);

  // Per-task aggregation
  const taskCosts = useMemo(() => {
    const taskMap = new Map<string, { inputTokens: number; outputTokens: number; runs: number }>();
    for (const run of runs) {
      const existing = taskMap.get(run.taskId) ?? { inputTokens: 0, outputTokens: 0, runs: 0 };
      existing.inputTokens += Number(run.costInputTokens) || 0;
      existing.outputTokens += Number(run.costOutputTokens) || 0;
      existing.runs += 1;
      taskMap.set(run.taskId, existing);
    }

    const taskNameMap = new Map<string, string>();
    for (const task of taskList) {
      taskNameMap.set(task.id, task.title);
    }

    const arr = Array.from(taskMap.entries()).map(([taskId, data]) => ({
      taskId,
      title: taskNameMap.get(taskId) ?? taskId,
      ...data,
      cost: calculateCost(data.inputTokens, data.outputTokens),
    }));

    arr.sort((a, b) => {
      let va: number;
      let vb: number;
      switch (taskSortField) {
        case 'cost':
          va = a.cost; vb = b.cost; break;
        case 'inputTokens':
          va = a.inputTokens; vb = b.inputTokens; break;
        case 'outputTokens':
          va = a.outputTokens; vb = b.outputTokens; break;
        case 'runs':
          va = a.runs; vb = b.runs; break;
        default:
          va = 0; vb = 0;
      }
      return taskSortDir === 'desc' ? vb - va : va - vb;
    });

    return arr;
  }, [runs, taskList, taskSortField, taskSortDir]);

  const handleTaskSort = (field: TaskSortField) => {
    if (taskSortField === field) {
      setTaskSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setTaskSortField(field);
      setTaskSortDir('desc');
    }
  };

  const sortIndicator = (field: TaskSortField) =>
    taskSortField === field ? (taskSortDir === 'desc' ? ' \u25BC' : ' \u25B2') : '';

  const loading = runsLoading || tasksLoading || chatCostsLoading;

  if (loading && runs.length === 0) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading cost data...</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl overflow-hidden">
      <h1 className="text-2xl font-bold">Cost Overview</h1>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Estimated Cost</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-2xl font-bold">{formatCost(summary.totalCost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Input Tokens</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-2xl font-bold">{formatTokens(summary.inputTokens)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Output Tokens</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-2xl font-bold">{formatTokens(summary.outputTokens)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Runs</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-2xl font-bold">{summary.totalRuns.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Cost breakdown by source */}
      {summary.chatCost > 0 && (
        <div className="text-xs text-muted-foreground flex gap-4">
          <span>Agent Runs: {formatCost(summary.totalCost - summary.chatCost)}</span>
          <span>Chat: {formatCost(summary.chatCost)}</span>
        </div>
      )}

      {/* Time aggregation */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base">Cost by Period</CardTitle>
          <div className="flex gap-1">
            {(['day', 'week', 'month'] as TimeGranularity[]).map((g) => (
              <Button
                key={g}
                variant={timeGranularity === g ? 'default' : 'outline'}
                size="sm"
                onClick={() => setTimeGranularity(g)}
              >
                {g.charAt(0).toUpperCase() + g.slice(1)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="py-0">
          {timePeriods.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No data available.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Input Tokens</th>
                  <th className="py-2 pr-3">Output Tokens</th>
                  <th className="py-2 pr-3">Runs</th>
                  <th className="py-2">Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {timePeriods.map((row) => (
                  <tr key={row.period} className="border-b last:border-0">
                    <td className="py-2 pr-3">{row.period}</td>
                    <td className="py-2 pr-3 font-mono">{formatTokens(row.inputTokens)}</td>
                    <td className="py-2 pr-3 font-mono">{formatTokens(row.outputTokens)}</td>
                    <td className="py-2 pr-3 font-mono">{row.runs}</td>
                    <td className="py-2 font-mono">{formatCost(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Per-task cost table */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Cost by Task</CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          {taskCosts.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No data available.</p>
          ) : (
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3" style={{ width: '40%' }}>Task</th>
                  <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => handleTaskSort('inputTokens')}>
                    Input Tokens{sortIndicator('inputTokens')}
                  </th>
                  <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => handleTaskSort('outputTokens')}>
                    Output Tokens{sortIndicator('outputTokens')}
                  </th>
                  <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => handleTaskSort('runs')}>
                    Runs{sortIndicator('runs')}
                  </th>
                  <th className="py-2 cursor-pointer select-none" onClick={() => handleTaskSort('cost')}>
                    Est. Cost{sortIndicator('cost')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {taskCosts.map((row) => (
                  <tr key={row.taskId} className="border-b last:border-0">
                    <td className="py-2 pr-3 overflow-hidden text-ellipsis whitespace-nowrap" title={row.title}>{row.title}</td>
                    <td className="py-2 pr-3 font-mono">{formatTokens(row.inputTokens)}</td>
                    <td className="py-2 pr-3 font-mono">{formatTokens(row.outputTokens)}</td>
                    <td className="py-2 pr-3 font-mono">{row.runs}</td>
                    <td className="py-2 font-mono">{formatCost(row.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Cost estimates use default Sonnet 4 pricing ($3/$15 per MTok input/output).
      </p>
    </div>
  );
}
