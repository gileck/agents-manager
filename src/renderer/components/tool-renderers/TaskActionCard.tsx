import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { TaskBaseCard } from './TaskBaseCard';
import type { Task, Transition } from '../../../shared/types';

interface TaskActionCardProps {
  task: Task;
  rawOutput: string;
}

const AGENT_BUTTONS: { label: string; agentType: string; mode: 'new' | 'revision'; variant: 'default' | 'secondary' | 'outline' }[] = [
  { label: 'Plan', agentType: 'planner', mode: 'new', variant: 'default' },
  { label: 'Implement', agentType: 'implementor', mode: 'new', variant: 'secondary' },
  { label: 'Review', agentType: 'reviewer', mode: 'new', variant: 'outline' },
];

export function TaskActionCard({ task, rawOutput }: TaskActionCardProps) {
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [transitionsError, setTransitionsError] = useState<string | null>(null);
  const [transitionLoading, setTransitionLoading] = useState<string | null>(null);
  const [agentLoading, setAgentLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    window.api.tasks.transitions(task.id)
      .then((result) => setTransitions(result.transitions))
      .catch(() => setTransitionsError('Transitions unavailable'));
  }, [task.id]);

  async function handleTransition(toStatus: string) {
    setTransitionLoading(toStatus);
    setActionError(null);
    try {
      await window.api.tasks.transition(task.id, toStatus);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setTransitionLoading(null);
    }
  }

  async function handleAgentStart(agentType: string, mode: 'new' | 'revision') {
    setAgentLoading(agentType);
    setActionError(null);
    try {
      await window.api.agents.start(task.id, mode, agentType);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start agent');
    } finally {
      setAgentLoading(null);
    }
  }

  return (
    <TaskBaseCard task={task}>
      {/* Transition buttons */}
      {transitionsError ? (
        <p className="text-xs text-muted-foreground">{transitionsError}</p>
      ) : transitions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {transitions.map((t) => (
            <Button
              key={t.to}
              size="sm"
              variant="outline"
              disabled={transitionLoading !== null || agentLoading !== null}
              onClick={() => handleTransition(t.to)}
            >
              {transitionLoading === t.to ? 'Moving…' : (t.label || t.to)}
            </Button>
          ))}
        </div>
      )}

      {/* Agent action buttons: Plan / Implement / Review */}
      <div className="flex flex-wrap gap-1.5">
        {AGENT_BUTTONS.map(({ label, agentType, mode, variant }) => (
          <Button
            key={agentType}
            size="sm"
            variant={variant}
            disabled={agentLoading !== null || transitionLoading !== null}
            onClick={() => handleAgentStart(agentType, mode)}
          >
            {agentLoading === agentType ? 'Starting…' : label}
          </Button>
        ))}
      </div>

      {/* Inline error */}
      {actionError && (
        <p className="text-xs text-destructive">{actionError}</p>
      )}

      {/* Raw output toggle */}
      <div>
        <button
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          onClick={() => setShowRaw((v) => !v)}
        >
          {showRaw ? 'Hide raw output' : 'Show raw output'}
        </button>
        {showRaw && (
          <pre className="mt-1 text-xs bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap" style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {rawOutput}
          </pre>
        )}
      </div>
    </TaskBaseCard>
  );
}
