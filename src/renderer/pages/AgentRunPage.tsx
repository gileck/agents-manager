import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useIpc } from '@template/renderer/hooks/useIpc';
import type { AgentRun, Task } from '../../shared/types';

const OUTCOME_MESSAGES: Record<string, string> = {
  plan_complete: 'Plan is ready for review. Go to task to review and approve.',
  pr_ready: 'PR has been created.',
  needs_info: 'Agent needs more information.',
  failed: 'Agent run failed. Go to task for recovery options.',
};

export function AgentRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { data: run, loading, error, refetch } = useIpc<AgentRun | null>(
    () => window.api.agents.get(runId!),
    [runId]
  );

  // Fetch associated task
  const { data: associatedTask } = useIpc<Task | null>(
    () => run?.taskId ? window.api.tasks.get(run.taskId) : Promise.resolve(null),
    [run?.taskId]
  );

  const [streamOutput, setStreamOutput] = useState('');
  const outputRef = useRef<HTMLPreElement>(null);
  const shouldAutoScroll = useRef(true);

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

    return () => { unsubscribe(); };
  }, [run?.taskId]);

  // Track scroll position to disable auto-scroll when user scrolls up
  const handleScroll = useCallback(() => {
    if (!outputRef.current) return;
    const el = outputRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    shouldAutoScroll.current = atBottom;
  }, []);

  // Auto-scroll output to bottom only if user hasn't scrolled up
  useEffect(() => {
    if (outputRef.current && shouldAutoScroll.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamOutput, run?.output]);

  const [restarting, setRestarting] = useState(false);

  const handleStop = async () => {
    if (!runId) return;
    await window.api.agents.stop(runId);
    await refetch();
  };

  const handleRestart = async () => {
    if (!run) return;
    setRestarting(true);
    try {
      const newRun = await window.api.agents.start(run.taskId, run.mode, run.agentType);
      navigate(`/agents/${newRun.id}`, { replace: true });
    } finally {
      setRestarting(false);
    }
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
  const outcomeMessage = run.outcome ? OUTCOME_MESSAGES[run.outcome] : null;

  return (
    <div className="p-8 flex flex-col" style={{ minHeight: 'calc(100vh - 4rem)' }}>
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 self-start"
        onClick={() => {
          if (associatedTask) {
            navigate(`/tasks/${associatedTask.id}`);
          } else {
            navigate(-1 as any);
          }
        }}
      >
        &larr; {associatedTask ? `Back to ${associatedTask.title}` : 'Back'}
      </Button>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Badge variant={run.status === 'completed' ? 'success' : run.status === 'running' ? 'default' : 'destructive'}>
            {run.status}
          </Badge>
          <h1 className="text-2xl font-bold">Agent Run</h1>
          <span className="text-sm text-muted-foreground">{run.mode} / {run.agentType}</span>
        </div>
        <div className="flex gap-2">
          {run.status === 'running' && (
            <Button variant="destructive" size="sm" onClick={handleStop}>Stop Agent</Button>
          )}
          {run.status !== 'running' && (
            <Button size="sm" onClick={handleRestart} disabled={restarting}>
              {restarting ? 'Restarting...' : 'Restart Agent'}
            </Button>
          )}
        </div>
      </div>

      {/* Task context link */}
      {associatedTask && (
        <div className="mb-2">
          <button
            className="text-sm text-blue-500 hover:underline"
            onClick={() => navigate(`/tasks/${associatedTask.id}`)}
          >
            Task: {associatedTask.title}
          </button>
        </div>
      )}

      <div className="flex gap-4 text-sm text-muted-foreground mb-4">
        <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
        {run.completedAt && <span>Completed: {new Date(run.completedAt).toLocaleString()}</span>}
        {run.outcome && <span>Outcome: {run.outcome}</span>}
        {run.exitCode !== null && <span>Exit Code: {run.exitCode}</span>}
      </div>

      {/* Outcome message after completion */}
      {run.status !== 'running' && outcomeMessage && (
        <div className="mb-4 rounded-md border px-4 py-3 flex items-center gap-3">
          <span className="text-sm">{outcomeMessage}</span>
          {associatedTask && (
            <Button size="sm" variant="outline" onClick={() => navigate(`/tasks/${associatedTask.id}`)}>
              Go to Task
            </Button>
          )}
        </div>
      )}

      <Card className="flex-1 flex flex-col min-h-0">
        <CardHeader className="py-3">
          <CardTitle className="text-base">
            Output
            {run.status === 'running' && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">(streaming...)</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 pb-4">
          <pre
            ref={outputRef}
            onScroll={handleScroll}
            className="text-xs bg-muted p-4 rounded overflow-auto whitespace-pre-wrap h-full"
            style={{ maxHeight: 'calc(100vh - 320px)', minHeight: '300px' }}
          >
            {displayOutput || (run.status === 'running' ? 'Waiting for output...' : '')}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
