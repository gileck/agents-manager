import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import type { AgentRun } from '../../../shared/types';
import { calculateCost, formatCost } from '../../../shared/cost-utils';

interface AgentRunsCardProps {
  agentRuns: AgentRun[] | null;
  onNavigateToRun: (runId: string) => void;
}

function StatusDot({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <span
        className="shrink-0"
        style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#3fb950', display: 'inline-block' }}
      />
    );
  }
  if (status === 'running') {
    return (
      <span
        className="shrink-0 animate-pulse"
        style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#58a6ff', display: 'inline-block' }}
      />
    );
  }
  // failed / error / stopped
  return (
    <span
      className="shrink-0"
      style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#f85149', display: 'inline-block' }}
    />
  );
}

export function AgentRunsCard({ agentRuns, onNavigateToRun }: AgentRunsCardProps) {
  const [expanded, setExpanded] = useState(false);
  const runs = agentRuns ?? [];
  const displayRuns = expanded ? runs : runs.slice(0, 3);

  return (
    <Card>
      <CardHeader
        className="py-3 cursor-pointer select-none hover:bg-muted/50 transition-colors"
        onClick={() => runs.length > 0 && setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Agent Runs</CardTitle>
          <div className="flex items-center gap-2">
            {runs.length > 0 && (
              <span className="text-xs text-muted-foreground">{runs.length}</span>
            )}
            {runs.length > 3 && (
              <span
                className="text-xs text-muted-foreground"
                style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}
              >
                &#x25BC;
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No agent runs yet.</p>
        ) : (
          <div className="space-y-1">
            {displayRuns.map((run) => {
              const cost = calculateCost(run.costInputTokens, run.costOutputTokens);
              return (
                <div
                  key={run.id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-accent/50 cursor-pointer text-xs"
                  onClick={() => onNavigateToRun(run.id)}
                >
                  <StatusDot status={run.status} />
                  <span className="flex-1 truncate">{run.mode} / {run.agentType}</span>
                  <span className="text-muted-foreground shrink-0">{formatCost(cost)}</span>
                </div>
              );
            })}
            {!expanded && runs.length > 3 && (
              <div className="text-xs text-muted-foreground pt-1 pl-2">
                +{runs.length - 3} more
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
