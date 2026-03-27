import React from 'react';
import { Button } from '../ui/button';
import { SplitButton } from '../ui/SplitButton';
import { FixOptionCards } from '../docs/FixOptionCards';
import { getRecommendedTransition, isEscapeTransition } from '../../utils/getRecommendedTransition';
import { AgentRunErrorBanner } from '../agent-run/AgentRunErrorBanner';
import type { AgentRun, Transition, ImplementationPhase, TaskType, TaskSize, TaskComplexity, TaskContextEntry, ProposedFixOption, GuardBlockRecord } from '../../../shared/types';
import type { StatusMeta } from '../../hooks/usePipelineStatusMeta';

type TaskProps = {
  status: string;
  prLink?: string | null;
  type?: TaskType | null;
  size?: TaskSize | null;
  complexity?: TaskComplexity | null;
};

function renderSmartTransitions(
  task: TaskProps,
  primaryTransitions: Transition[],
  transitioning: string | null,
  onTransition: (toStatus: string) => void
) {
  if (!primaryTransitions.length) return null;

  const recommended = getRecommendedTransition(task, primaryTransitions);
  const escapeTransitions = primaryTransitions.filter(isEscapeTransition);
  const forwardTransitions = primaryTransitions.filter((t) => !isEscapeTransition(t));

  // Single transition: plain button, no dropdown needed
  if (primaryTransitions.length === 1) {
    const t = primaryTransitions[0];
    return (
      <Button
        size="sm"
        onClick={() => onTransition(t.to)}
        disabled={transitioning !== null}
      >
        {transitioning === t.to ? 'Transitioning...' : (t.label || `Move to ${t.to}`)}
      </Button>
    );
  }

  // No recommended: fall back to all buttons flat
  if (!recommended) {
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

  const otherForwardTransitions = forwardTransitions.filter((t) => t.to !== recommended.to);

  return (
    <SplitButton
      primaryTransition={recommended}
      otherForwardTransitions={otherForwardTransitions}
      escapeTransitions={escapeTransitions}
      transitioning={transitioning}
      onTransition={onTransition}
    />
  );
}

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
  contextEntries,
  taskId,
  guardBlocks,
  stuckReason,
  taskTitle,
}: {
  task: TaskProps;
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
  contextEntries?: TaskContextEntry[];
  taskId?: string;
  guardBlocks?: GuardBlockRecord[];
  stuckReason?: string;
  taskTitle?: string;
}) {
  if (!isAgentPipeline) {
    // Fallback: render smart split button
    const rendered = renderSmartTransitions(task, primaryTransitions, transitioning, onTransition);
    if (!rendered) return null;
    return <div className="flex items-center gap-2 flex-wrap">{rendered}</div>;
  }

  const status = task.status;

  // Ready category (open, reported, etc.): show smart primary forward transition
  if (statusMeta.isReady) {
    const rendered = renderSmartTransitions(task, primaryTransitions, transitioning, onTransition);
    if (!rendered) return null;
    return <div className="flex items-center gap-2 flex-wrap">{rendered}</div>;
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
      <div className="rounded-md px-4 py-3 flex flex-col gap-3" style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5' }}>
        <div className="min-w-0">
          {lastRun?.error ? (
            <AgentRunErrorBanner error={lastRun.error} compact />
          ) : (
            <span className="text-sm font-medium" style={{ color: '#dc2626' }}>Agent failed or not running</span>
          )}
          {maxRetriesExhausted && (
            <p className="text-xs mt-1" style={{ color: '#dc2626' }}>
              Implementation failed after {totalFailedRuns} attempts. Use the Force Transition button below to recover, or go back to planning.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-between">
          <div>
            {lastRun && (
              <button
                className="text-sm text-blue-500 hover:underline"
                onClick={() => onNavigateToRun(lastRun.id)}
              >
                View Last Run
              </button>
            )}
          </div>
          <div className="flex gap-2">
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
      </div>
    );
  }

  // Human review (plan_review, investigation_review, pr_review, etc.)
  if (statusMeta.isHumanReview) {
    // Guard-blocked banner: show when an agent transition was blocked by guards
    const activeGuardBlocks = (guardBlocks ?? []).filter(
      (gb) => gb.fromStatus === status && gb.trigger === 'agent',
    );

    if (activeGuardBlocks.length > 0 && isStuck) {
      const latestBlock = activeGuardBlocks[activeGuardBlocks.length - 1];
      const guardReasons = latestBlock.guardFailures.map((g) => g.reason).join('; ');
      return (
        <div className="rounded-md px-4 py-3 flex flex-col gap-3" style={{ backgroundColor: '#fefce8', border: '1px solid #fbbf24' }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span style={{ color: '#d97706', fontSize: 16 }}>&#x26A0;</span>
              <span className="text-sm font-medium" style={{ color: '#92400e' }}>
                Task is stuck — transition blocked
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: '#92400e' }}>
              Agent transition to &quot;{latestBlock.toStatus}&quot; was blocked: {guardReasons}
            </p>
            {stuckReason && stuckReason !== guardReasons && (
              <p className="text-xs mt-0.5" style={{ color: '#a16207' }}>
                {stuckReason}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-between">
            <div className="flex gap-2">
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
              {onOpenForceDialog && (
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
        </div>
      );
    }

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
    // Investigation review with fix option cards
    if (status === 'investigation_review' && contextEntries && taskId) {
      const fixOptionsEntry = [...contextEntries]
        .filter(e => e.entryType === 'fix_options_proposed')
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      const options = (fixOptionsEntry?.data as { options?: ProposedFixOption[] })?.options;

      if (options && options.length > 0) {
        return (
          <FixOptionCards
            options={options}
            taskId={taskId}
            taskTitle={taskTitle ?? ''}
            transitions={primaryTransitions}
            transitioning={transitioning}
            onTransition={onTransition}
            compact
            taskType={task.type ?? undefined}
          />
        );
      }
    }
    // Triage review: use triager's suggestedPhase as recommended CTA
    if (status === 'triage_review' && contextEntries) {
      const triageEntry = [...contextEntries]
        .filter(e => e.entryType === 'triage_summary')
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      const suggestedPhase = (triageEntry?.data as { suggestedPhase?: string } | undefined)?.suggestedPhase;

      if (suggestedPhase) {
        const matchingTransition = primaryTransitions.find(t => t.to === suggestedPhase);
        if (matchingTransition) {
          const otherForward = primaryTransitions.filter(t => !isEscapeTransition(t) && t.to !== suggestedPhase);
          const escapes = primaryTransitions.filter(t => isEscapeTransition(t) && t.to !== suggestedPhase);

          return (
            <div className="flex items-center gap-2 flex-wrap">
              <SplitButton
                primaryTransition={matchingTransition}
                otherForwardTransitions={otherForward}
                escapeTransitions={escapes}
                transitioning={transitioning}
                onTransition={onTransition}
              />
            </div>
          );
        }
      }
    }
    // Generic human review (plan_review, design_review, investigation_review without options, etc.)
    // Use SplitButton with recommended transition instead of flat button dump
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {renderSmartTransitions(task, primaryTransitions, transitioning, onTransition)}
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

