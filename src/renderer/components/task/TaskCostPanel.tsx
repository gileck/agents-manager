import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { calculateCost, formatCost, formatTokens } from '../../../shared/cost-utils';
import type { AgentRun } from '../../../shared/types';

interface TaskCostPanelProps {
  runs: AgentRun[];
}

type SortField = 'cost' | 'inputTokens' | 'outputTokens' | 'duration' | 'startedAt';
type SortDir = 'asc' | 'desc';

export function TaskCostPanel({ runs }: TaskCostPanelProps) {
  const [sortField, setSortField] = useState<SortField>('cost');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const totals = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const run of runs) {
      inputTokens += run.costInputTokens ?? 0;
      outputTokens += run.costOutputTokens ?? 0;
    }
    return {
      inputTokens,
      outputTokens,
      cost: calculateCost(inputTokens, outputTokens),
    };
  }, [runs]);

  const sortedRuns = useMemo(() => {
    const arr = [...runs];
    arr.sort((a, b) => {
      let va: number;
      let vb: number;
      switch (sortField) {
        case 'cost':
          va = calculateCost(a.costInputTokens, a.costOutputTokens);
          vb = calculateCost(b.costInputTokens, b.costOutputTokens);
          break;
        case 'inputTokens':
          va = a.costInputTokens ?? 0;
          vb = b.costInputTokens ?? 0;
          break;
        case 'outputTokens':
          va = a.costOutputTokens ?? 0;
          vb = b.costOutputTokens ?? 0;
          break;
        case 'duration':
          va = a.completedAt && a.startedAt ? a.completedAt - a.startedAt : 0;
          vb = b.completedAt && b.startedAt ? b.completedAt - b.startedAt : 0;
          break;
        case 'startedAt':
          va = a.startedAt;
          vb = b.startedAt;
          break;
        default:
          va = 0;
          vb = 0;
      }
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return arr;
  }, [runs, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortIndicator = (field: SortField) =>
    sortField === field ? (sortDir === 'desc' ? ' \u25BC' : ' \u25B2') : '';

  if (runs.length === 0) {
    return (
      <Card className="mt-4">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">No agent runs yet. Cost data will appear here after agents run.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Input Tokens</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-2xl font-bold">{formatTokens(totals.inputTokens)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Output Tokens</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-2xl font-bold">{formatTokens(totals.outputTokens)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Estimated Total Cost</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-2xl font-bold">{formatCost(totals.cost)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Runs table */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Agent Runs Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3">Mode</th>
                <th className="py-2 pr-3">Agent</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => handleSort('inputTokens')}>
                  Input Tokens{sortIndicator('inputTokens')}
                </th>
                <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => handleSort('outputTokens')}>
                  Output Tokens{sortIndicator('outputTokens')}
                </th>
                <th className="py-2 pr-3 cursor-pointer select-none" onClick={() => handleSort('cost')}>
                  Est. Cost{sortIndicator('cost')}
                </th>
                <th className="py-2 cursor-pointer select-none" onClick={() => handleSort('duration')}>
                  Duration{sortIndicator('duration')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRuns.map((run) => {
                const cost = calculateCost(run.costInputTokens, run.costOutputTokens);
                const duration = run.completedAt && run.startedAt
                  ? Math.round((run.completedAt - run.startedAt) / 1000)
                  : null;
                return (
                  <tr key={run.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{run.mode}</td>
                    <td className="py-2 pr-3">{run.agentType}</td>
                    <td className="py-2 pr-3">{run.status}</td>
                    <td className="py-2 pr-3 font-mono">{formatTokens(run.costInputTokens)}</td>
                    <td className="py-2 pr-3 font-mono">{formatTokens(run.costOutputTokens)}</td>
                    <td className="py-2 pr-3 font-mono">{formatCost(cost)}</td>
                    <td className="py-2 font-mono">
                      {duration != null ? `${Math.floor(duration / 60)}m ${duration % 60}s` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
