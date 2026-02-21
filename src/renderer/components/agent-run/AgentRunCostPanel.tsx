import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { calculateCost, formatCost, formatTokens } from '../../../shared/cost-utils';
import type { AgentRun } from '../../../shared/types';

interface AgentRunCostPanelProps {
  run: AgentRun;
}

export function AgentRunCostPanel({ run }: AgentRunCostPanelProps) {
  const inputTokens = Number(run.costInputTokens) || 0;
  const outputTokens = Number(run.costOutputTokens) || 0;
  const totalTokens = inputTokens + outputTokens;

  const inputCost = calculateCost(inputTokens, 0);
  const outputCost = calculateCost(0, outputTokens);
  const totalCost = inputCost + outputCost;

  const isRunning = run.status === 'running';

  // Use a ticking timer for live duration during running state
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  const duration = run.completedAt && run.startedAt
    ? (run.completedAt - run.startedAt) / 1000
    : isRunning && run.startedAt
    ? (now - run.startedAt) / 1000
    : null;

  const costPerMinute = duration && duration > 0
    ? totalCost / (duration / 60)
    : null;

  if (inputTokens === 0 && outputTokens === 0) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">
          {isRunning ? 'Waiting for token usage data...' : 'No token usage data available for this run.'}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Token counts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Input Tokens</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-2xl font-bold">{formatTokens(inputTokens)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Output Tokens</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-2xl font-bold">{formatTokens(outputTokens)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Tokens</CardTitle>
          </CardHeader>
          <CardContent className="py-2">
            <p className="text-2xl font-bold">{formatTokens(totalTokens)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Cost breakdown */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Estimated Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b">
                <td className="py-2 text-muted-foreground">Input cost</td>
                <td className="py-2 font-mono text-right">{formatCost(inputCost)}</td>
              </tr>
              <tr className="border-b">
                <td className="py-2 text-muted-foreground">Output cost</td>
                <td className="py-2 font-mono text-right">{formatCost(outputCost)}</td>
              </tr>
              <tr className="font-semibold">
                <td className="py-2">Total estimated cost</td>
                <td className="py-2 font-mono text-right">{formatCost(totalCost)}</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Duration and cost/minute */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Timing</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b">
                <td className="py-2 text-muted-foreground">Duration</td>
                <td className="py-2 font-mono text-right">
                  {duration != null
                    ? `${Math.floor(duration / 60)}m ${Math.round(duration % 60)}s`
                    : 'In progress'}
                </td>
              </tr>
              {costPerMinute != null && (
                <tr>
                  <td className="py-2 text-muted-foreground">Cost per minute</td>
                  <td className="py-2 font-mono text-right">{formatCost(costPerMinute)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Cost estimates use default Sonnet 4 pricing ($3/$15 per MTok input/output).
      </p>
    </div>
  );
}
