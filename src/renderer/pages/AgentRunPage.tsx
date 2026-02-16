import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useIpc } from '@template/renderer/hooks/useIpc';
import type { AgentRun } from '../../shared/types';

export function AgentRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { data: run, loading, error, refetch } = useIpc<AgentRun | null>(
    () => window.api.agents.get(runId!),
    [runId]
  );

  const [streamOutput, setStreamOutput] = useState('');
  const outputRef = useRef<HTMLPreElement>(null);

  // Poll for status updates while running
  useEffect(() => {
    if (!run || run.status !== 'running') return;

    const interval = setInterval(() => {
      refetch();
    }, 2000);

    return () => clearInterval(interval);
  }, [run?.status, refetch]);

  // Subscribe to streaming output
  useEffect(() => {
    if (!run) return;

    const unsubscribe = window.api.on.agentOutput((taskId: string, chunk: string) => {
      if (taskId === run.taskId) {
        setStreamOutput((prev) => prev + chunk);
      }
    });

    return unsubscribe;
  }, [run?.taskId]);

  // Auto-scroll output to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamOutput, run?.output]);

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

  const displayOutput = run.status === 'running' ? streamOutput : (run.output || streamOutput);

  return (
    <div className="p-8">
      <Button variant="ghost" size="sm" className="mb-4" onClick={() => navigate(-1 as any)}>
        &larr; Back
      </Button>

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

      {(displayOutput || run.status === 'running') && (
        <Card>
          <CardHeader>
            <CardTitle>
              Output
              {run.status === 'running' && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">(streaming...)</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre
              ref={outputRef}
              className="text-xs bg-muted p-4 rounded overflow-x-auto whitespace-pre-wrap"
              style={{ maxHeight: '600px', overflowY: 'auto' }}
            >
              {displayOutput || (run.status === 'running' ? 'Waiting for output...' : '')}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
