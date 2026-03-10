import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import type { AgentRun } from '../../../shared/types';

interface AgentRunInfoCardProps {
  agentRunId: string;
  taskId?: string;
  agentType?: string;
}

function formatDuration(startedAt: number, completedAt: number | null): string {
  const endMs = completedAt ?? Date.now();
  const seconds = Math.floor((endMs - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

const STATUS_COLORS: Record<string, string> = {
  running: 'text-blue-600 bg-blue-50 border-blue-200',
  completed: 'text-green-700 bg-green-50 border-green-200',
  failed: 'text-red-600 bg-red-50 border-red-200',
  timed_out: 'text-orange-600 bg-orange-50 border-orange-200',
  cancelled: 'text-muted-foreground bg-muted/40 border-border',
};

export function AgentRunInfoCard({ agentRunId, taskId, agentType }: AgentRunInfoCardProps) {
  const navigate = useNavigate();
  const [run, setRun] = useState<AgentRun | null>(null);
  const [elapsed, setElapsed] = useState('');
  const [stopping, setStopping] = useState(false);

  const fetchRun = useCallback(async () => {
    try {
      const fetched = await window.api.agents.get(agentRunId);
      if (fetched) setRun(fetched);
    } catch {
      // best effort
    }
  }, [agentRunId]);

  // Initial fetch
  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  // Subscribe to agentStatus events for this task
  useEffect(() => {
    if (!taskId) return;
    const unsub = window.api?.on?.agentStatus?.((tid: string) => {
      if (tid === taskId) {
        fetchRun();
      }
    });
    return () => { unsub?.(); };
  }, [taskId, fetchRun]);

  // Live elapsed timer for running runs
  useEffect(() => {
    if (!run) return;
    if (run.status !== 'running') {
      setElapsed(formatDuration(run.startedAt, run.completedAt));
      return;
    }
    setElapsed(formatDuration(run.startedAt, null));
    const interval = setInterval(() => {
      setElapsed(formatDuration(run.startedAt, null));
    }, 1000);
    return () => clearInterval(interval);
  }, [run]);

  async function handleStop() {
    if (!run) return;
    setStopping(true);
    try {
      await window.api.agents.stop(agentRunId);
    } catch {
      // best effort
    } finally {
      setStopping(false);
    }
  }

  const displayType = agentType ?? run?.agentType ?? 'agent';
  const status = run?.status ?? 'running';
  const statusColor = STATUS_COLORS[status] ?? STATUS_COLORS['cancelled'];
  const isRunning = status === 'running';

  return (
    <div className="inline-flex items-center gap-2 border border-border/70 rounded-lg px-3 py-2 bg-card text-xs my-1">
      {/* Agent type chip */}
      <span className="font-medium text-foreground capitalize">{displayType}</span>

      {/* Status badge */}
      <span className={`inline-flex items-center gap-1 border rounded-full px-2 py-0.5 text-[10px] font-medium ${statusColor}`}>
        {isRunning && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        )}
        {status}
      </span>

      {/* Elapsed */}
      {elapsed && (
        <span className="text-muted-foreground">{elapsed}</span>
      )}

      {/* Actions */}
      <Button
        size="sm"
        variant="ghost"
        className="h-5 px-1.5 text-[10px]"
        onClick={() => navigate(`/agents/${agentRunId}`)}
      >
        View
      </Button>
      {isRunning && (
        <Button
          size="sm"
          variant="ghost"
          className="h-5 px-1.5 text-[10px] text-destructive hover:text-destructive"
          disabled={stopping}
          onClick={handleStop}
        >
          {stopping ? 'Stopping…' : 'Stop'}
        </Button>
      )}
    </div>
  );
}
