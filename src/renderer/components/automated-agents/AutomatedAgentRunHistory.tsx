import React from 'react';
import { useNavigate } from 'react-router-dom';
import { InlineError } from '../InlineError';
import { useAutomatedAgentRuns } from '../../hooks/useAutomatedAgents';

interface AutomatedAgentRunHistoryProps {
  agentId: string;
}

export function AutomatedAgentRunHistory({ agentId }: AutomatedAgentRunHistoryProps) {
  const { runs, loading, error } = useAutomatedAgentRuns(agentId);
  const navigate = useNavigate();

  if (loading) return <p className="text-xs text-muted-foreground px-2 py-1">Loading runs...</p>;
  if (error) return <InlineError message={error} context="Run history" />;
  if (runs.length === 0) return <p className="text-xs text-muted-foreground px-2 py-1">No runs yet</p>;

  return (
    <div className="space-y-1">
      {runs.slice(0, 10).map((run) => {
        const duration = run.completedAt ? Math.round((run.completedAt - run.startedAt) / 1000) : null;
        const tokens = (run.costInputTokens ?? 0) + (run.costOutputTokens ?? 0);
        return (
          <button
            key={run.id}
            onClick={() => navigate(`/automated-agents/runs/${run.id}`)}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${
                run.status === 'completed' ? 'bg-green-500' :
                run.status === 'failed' ? 'bg-red-500' :
                run.status === 'running' ? 'bg-blue-500 animate-pulse' :
                'bg-gray-400'
              }`} />
              <span className="text-muted-foreground">
                {new Date(run.startedAt).toLocaleString()}
              </span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              {duration !== null && <span>{duration}s</span>}
              {tokens > 0 && <span>{tokens.toLocaleString()} tok</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
