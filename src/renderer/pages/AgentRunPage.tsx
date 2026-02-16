import React from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useIpc } from '@template/renderer/hooks/useIpc';
import type { AgentRun } from '../../shared/types';

export function AgentRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const { data: run, loading, error, refetch } = useIpc<AgentRun | null>(
    () => window.api.agents.get(runId!),
    [runId]
  );

  const handleStop = async () => {
    if (!runId) return;
    await window.api.agents.stop(runId);
    await refetch();
  };

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading agent run...</p>
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="p-8">
        <p className="text-destructive">{error || 'Agent run not found'}</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Badge variant={run.status === 'completed' ? 'success' : run.status === 'running' ? 'default' : 'destructive'}>
            {run.status}
          </Badge>
          <h1 className="text-3xl font-bold">Agent Run</h1>
        </div>
        {run.status === 'running' && (
          <Button variant="destructive" onClick={handleStop}>Stop Agent</Button>
        )}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Run Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '0.75rem' }}>
            <span className="text-sm text-muted-foreground">Status</span>
            <Badge variant={run.status === 'completed' ? 'success' : run.status === 'running' ? 'default' : 'destructive'}>
              {run.status}
            </Badge>

            <span className="text-sm text-muted-foreground">Mode</span>
            <span className="text-sm">{run.mode}</span>

            <span className="text-sm text-muted-foreground">Agent Type</span>
            <span className="text-sm">{run.agentType}</span>

            <span className="text-sm text-muted-foreground">Started</span>
            <span className="text-sm">{new Date(run.startedAt).toLocaleString()}</span>

            {run.completedAt && (
              <>
                <span className="text-sm text-muted-foreground">Completed</span>
                <span className="text-sm">{new Date(run.completedAt).toLocaleString()}</span>
              </>
            )}

            {run.outcome && (
              <>
                <span className="text-sm text-muted-foreground">Outcome</span>
                <span className="text-sm">{run.outcome}</span>
              </>
            )}

            {run.exitCode !== null && (
              <>
                <span className="text-sm text-muted-foreground">Exit Code</span>
                <span className="text-sm">{run.exitCode}</span>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {run.output && (
        <Card>
          <CardHeader>
            <CardTitle>Output</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-muted p-4 rounded overflow-x-auto whitespace-pre-wrap">
              {run.output}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
