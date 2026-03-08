import React from 'react';
import { Button } from '../ui/button';
import type { AgentRun, Transition, ImplementationPhase } from '../../../shared/types';
import type { StatusMeta } from '../../hooks/usePipelineStatusMeta';

export function StatusActionBar({
  task,
  isAgentPipeline,
  hasRunningAgent,
  lastRun,
  isStuck,
  isFinalizing,
  primaryTransitions,
  transitioning,
  statusMeta,
  onTransition,
  onNavigateToRun,
  phases,
  hasPendingPhases,
  totalFailedRuns,
  onOpenForceDialog,
}: {
  task: { status: string; prLink?: string | null };
  isAgentPipeline: boolean;
  hasRunningAgent: boolean;
  lastRun: AgentRun | null;
  isStuck: boolean;
  isFinalizing: boolean;
  primaryTransitions: Transition[];
  transitioning: string | null;
  statusMeta: StatusMeta;
  onTransition: (toStatus: string) => void;
  onNavigateToRun: (runId: string) => void;
  phases?: ImplementationPhase[];
  hasPendingPhases?: boolean;
  totalFailedRuns?: number;
  onOpenForceDialog?: () => void;
}) {
  if (!isAgentPipeline) {
    // Fallback: render all transitions as standard buttons
    if (!primaryTransitions.length) return null;
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {primaryTransitions.map((t) => (
          <Button
            key={t.to}
            size="sm"
            onClick={() => onTransition(t.to)}
            disabled={transitioning !== null}
          >
            {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
          </Button>
        ))}
      </div>
    );
  }

  const status = task.status;

  // Ready category (open, reported, etc.): show primary forward transitions
  if (statusMeta.isReady) {
    if (!primaryTransitions.length) return null;
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {primaryTransitions.map((t) => (
          <Button
            key={t.to}
            size="sm"
            onClick={() => onTransition(t.to)}
            disabled={transitioning !== null}
          >
            {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
          </Button>
        ))}
      </div>
    );
  }

  // Agent running / finalizing: pipeline stepper already shows animated state
  // and clicking the active node navigates to the agent run.
  if (statusMeta.isAgentRunning && (hasRunningAgent || isFinalizing)) {
    return null;
  }

  // Agent running stuck (failed or no agent)
  if (statusMeta.isAgentRunning && isStuck) {
    const maxRetriesExhausted = totalFailedRuns !== undefined && totalFailedRuns > 3;
    return (
      <div className="rounded-md px-4 py-3 flex items-center gap-3 flex-wrap" style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5' }}>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium" style={{ color: '#dc2626' }}>
            {lastRun?.error || 'Agent failed or not running'}
          </span>
          {maxRetriesExhausted && (
            <p className="text-xs mt-1" style={{ color: '#dc2626' }}>
              Max retries exhausted ({totalFailedRuns} failed runs). Use Force Transition to recover.
            </p>
          )}
        </div>
        {lastRun && (
          <button
            className="text-sm text-blue-500 hover:underline"
            onClick={() => onNavigateToRun(lastRun.id)}
          >
            View Last Run
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          {primaryTransitions.map((t) => (
            <Button
              key={t.to}
              variant="outline"
              size="sm"
              onClick={() => onTransition(t.to)}
              disabled={transitioning !== null}
            >
              {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
            </Button>
          ))}
          {maxRetriesExhausted && onOpenForceDialog && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onOpenForceDialog}
            >
              Force...
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Human review (plan_review, investigation_review, pr_review, etc.)
  if (statusMeta.isHumanReview) {
    // PR review has special handling for the PR link
    if (status === 'pr_review' || status === 'ready_to_merge') {
      return (
        <div className="flex items-center gap-2 flex-wrap">
          {task.prLink ? (
            <button
              onClick={() => window.api.shell.openInChrome(task.prLink!)}
              className="text-sm text-blue-500 hover:underline break-all text-left cursor-pointer"
            >
              {task.prLink}
            </button>
          ) : (
            <span className="text-sm text-muted-foreground animate-pulse">Creating PR...</span>
          )}
          {primaryTransitions.map((t) => (
            <Button
              key={t.to}
              size="sm"
              variant={t.to === 'done' ? 'default' : 'outline'}
              onClick={() => onTransition(t.to)}
              disabled={transitioning !== null}
            >
              {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
            </Button>
          ))}
        </div>
      );
    }
    // Generic human review (plan_review, investigation_review, etc.)
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {primaryTransitions.map((t) => (
          <Button
            key={t.to}
            size="sm"
            onClick={() => onTransition(t.to)}
            disabled={transitioning !== null}
          >
            {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
          </Button>
        ))}
      </div>
    );
  }

  // Waiting for input: prompt form appears in the tab content area
  if (statusMeta.isWaitingForInput) {
    return null;
  }

  // Terminal (done, closed, etc.) — enhanced with phase awareness
  if (statusMeta.isTerminal) {
    // Closed — neutral banner with reopen button
    if (status === 'closed') {
      return (
        <div className="rounded-md px-4 py-3 flex items-center gap-3" style={{ backgroundColor: '#f3f4f6', border: '1px solid #d1d5db' }}>
          <span className="text-sm font-medium" style={{ color: '#6b7280' }}>Task closed</span>
          {primaryTransitions.filter((t) => t.to !== 'closed').map((t) => (
            <Button
              key={t.to}
              variant="outline"
              size="sm"
              onClick={() => onTransition(t.to)}
              disabled={transitioning !== null}
            >
              {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
            </Button>
          ))}
        </div>
      );
    }

    // Done with pending phases — phase advance happening or failed
    if (hasPendingPhases && phases) {
      const completedCount = phases.filter((p) => p.status === 'completed').length;
      return (
        <div className="rounded-md px-4 py-3 flex items-center gap-2" style={{ backgroundColor: '#eff6ff', border: '1px solid #93c5fd' }}>
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
          </span>
          <span className="text-sm font-medium" style={{ color: '#2563eb' }}>
            Advancing to Phase {completedCount + 1} of {phases.length}...
          </span>
        </div>
      );
    }

    // All phases complete
    if (phases && phases.length > 1) {
      return (
        <div className="rounded-md px-4 py-3 flex items-center gap-2" style={{ backgroundColor: '#f0fdf4', border: '1px solid #86efac' }}>
          <span style={{ color: '#16a34a' }}>&#10003;</span>
          <span className="text-sm font-medium" style={{ color: '#16a34a' }}>
            All {phases.length} phases complete
          </span>
        </div>
      );
    }

    // Simple task complete - no status bar needed
    return null;
  }

  return null;
}
