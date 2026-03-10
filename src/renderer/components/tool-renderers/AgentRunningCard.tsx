import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useChatActions } from '../chat/ChatActionsContext';
import type { ToolRendererProps } from './types';
import type { AgentRunStatus } from '../../../shared/types';

interface CompactAgentRun {
  id: string;
  taskId: string;
  agentType: string;
  mode: string;
  status: AgentRunStatus;
  outcome: string | null;
  startedAt: number;
  completedAt: number | null;
}

const STATUS_VARIANTS: Record<AgentRunStatus, 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline'> = {
  running: 'default',
  completed: 'success',
  failed: 'destructive',
  timed_out: 'warning',
  cancelled: 'secondary',
};

function formatDuration(startedAt: number, completedAt: number | null): string {
  const end = completedAt ?? Date.now();
  const ms = end - startedAt;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.floor(s % 60)}s`;
}

function parseAgentRuns(result: string): CompactAgentRun[] | null {
  try {
    const parsed = JSON.parse(result);
    if (!Array.isArray(parsed)) return null;
    return parsed as CompactAgentRun[];
  } catch {
    return null;
  }
}

interface AgentRunRowProps {
  run: CompactAgentRun;
  isStreaming: boolean;
  sendMessage: (text: string) => void;
}

function AgentRunRow({ run, isStreaming, sendMessage }: AgentRunRowProps) {
  const navigate = useNavigate();

  function handleStop() {
    sendMessage(`Stop the agent run ${run.id}`);
  }

  const statusVariant = STATUS_VARIANTS[run.status] ?? 'outline';
  const duration = formatDuration(run.startedAt, run.completedAt);
  const isRunning = run.status === 'running';

  return (
    <li className="px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={statusVariant} className="text-[10px] px-1.5 py-0">
          {isRunning && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1 animate-pulse" />
          )}
          {run.status}
        </Badge>
        <span className="text-xs font-medium text-foreground">{run.agentType}</span>
        <span className="text-xs text-muted-foreground">{run.mode}</span>
        <span className="text-xs text-muted-foreground ml-auto">{duration}</span>
      </div>
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(`/agents/${run.id}`)}
        >
          View Run
        </Button>
        {isRunning && (
          <Button
            size="sm"
            variant="destructive"
            disabled={isStreaming}
            onClick={handleStop}
          >
            Stop Agent
          </Button>
        )}
      </div>
    </li>
  );
}

export function AgentRunningCard({ toolResult }: ToolRendererProps) {
  const { isStreaming, sendMessage } = useChatActions();

  if (!toolResult) {
    return (
      <div className="border border-border rounded p-3 my-1 bg-card text-xs text-muted-foreground">
        Loading agent runs…
      </div>
    );
  }

  const runs = parseAgentRuns(toolResult.result);

  if (!runs) {
    return (
      <div className="border border-destructive/40 rounded p-3 my-1 bg-card text-xs text-destructive">
        Failed to load agent runs
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="border border-border rounded p-3 my-1 bg-card text-xs text-muted-foreground">
        No agent runs found
      </div>
    );
  }

  const runningCount = runs.filter((r) => r.status === 'running').length;

  return (
    <div className="border border-border rounded my-1 bg-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border/60 bg-muted/30 flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">
          Agent Runs ({runs.length})
        </span>
        {runningCount > 0 && (
          <Badge variant="default" className="text-[10px] px-1.5 py-0">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1 animate-pulse" />
            {runningCount} running
          </Badge>
        )}
      </div>
      <ul className="divide-y divide-border/40 max-h-80 overflow-y-auto">
        {runs.map((run) => (
          <AgentRunRow key={run.id} run={run} isStreaming={isStreaming} sendMessage={sendMessage} />
        ))}
      </ul>
    </div>
  );
}
