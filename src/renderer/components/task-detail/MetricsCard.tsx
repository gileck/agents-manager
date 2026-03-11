import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { getEffectiveCost, formatCost, formatTokens } from '../../../shared/cost-utils';
import type { AgentRun } from '../../../shared/types';

interface MetricsCardProps {
  agentRuns: AgentRun[] | null;
}

export function MetricsCard({ agentRuns }: MetricsCardProps) {
  const totals = useMemo(() => {
    const runs = agentRuns ?? [];
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;
    for (const run of runs) {
      inputTokens += Number(run.costInputTokens) || 0;
      outputTokens += Number(run.costOutputTokens) || 0;
      cost += getEffectiveCost({ totalCostUsd: run.totalCostUsd, inputTokens: run.costInputTokens, outputTokens: run.costOutputTokens, cacheReadTokens: run.cacheReadInputTokens, cacheWriteTokens: run.cacheCreationInputTokens, model: run.model ?? undefined });
    }
    return { inputTokens, outputTokens, cost, runCount: runs.length };
  }, [agentRuns]);

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm">Metrics</CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div className="rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Total Cost</div>
            <div className="text-lg font-semibold">{formatCost(totals.cost)}</div>
          </div>
          <div className="rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Agent Runs</div>
            <div className="text-lg font-semibold">{totals.runCount}</div>
          </div>
          <div className="rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Input Tokens</div>
            <div className="text-lg font-semibold">{formatTokens(totals.inputTokens)}</div>
          </div>
          <div className="rounded-md border px-3 py-2">
            <div className="text-xs text-muted-foreground">Output Tokens</div>
            <div className="text-lg font-semibold">{formatTokens(totals.outputTokens)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
