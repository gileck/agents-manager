import React, { useState, useCallback } from 'react';
import { StatusActionBar } from './StatusActionBar';
import { HookFailureBanner } from './HookFailureBanner';
import { PhaseProgressBar } from './PhaseProgressBar';
import { TransitionMap } from './TransitionMap';
import { ForceTransitionDialog } from './ForceTransitionDialog';
import { usePipelineDiagnostics } from '../../hooks/usePipelineDiagnostics';
import { useHookRetry } from '../../hooks/useHookRetry';
import type { AgentRun, Transition, PipelineStatus, HookFailure } from '../../../shared/types';
import type { StatusMeta } from '../../hooks/usePipelineStatusMeta';

interface PipelineControlPanelProps {
  taskId: string;
  task: { status: string; prLink?: string | null };
  isAgentPipeline: boolean;
  hasRunningAgent: boolean;
  activeRun: AgentRun | null;
  lastRun: AgentRun | null;
  isStuck: boolean;
  isFinalizing: boolean;
  primaryTransitions: Transition[];
  transitioning: string | null;
  stoppingAgent: boolean;
  statusMeta: StatusMeta;
  pipelineStatuses: PipelineStatus[];
  onTransition: (toStatus: string) => void;
  onStopAgent: () => void;
  onNavigateToRun: (runId: string) => void;
  hookFailureAlerts: HookFailure[];
  onDismissHookAlert: (index: number) => void;
}

export function PipelineControlPanel({
  taskId,
  task,
  isAgentPipeline,
  hasRunningAgent,
  activeRun,
  lastRun,
  isStuck,
  isFinalizing,
  primaryTransitions,
  transitioning,
  stoppingAgent,
  statusMeta,
  pipelineStatuses,
  onTransition,
  onStopAgent,
  onNavigateToRun,
  hookFailureAlerts,
  onDismissHookAlert,
}: PipelineControlPanelProps) {
  const { diagnostics, refetch: refetchDiagnostics } = usePipelineDiagnostics(taskId, task.status);
  const { retry, retrying } = useHookRetry();
  const [forceDialogOpen, setForceDialogOpen] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [forceError, setForceError] = useState<string | null>(null);
  const [advancingPhase, setAdvancingPhase] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [dismissedFailureIds, setDismissedFailureIds] = useState<Set<string>>(new Set());

  const handleForceTransition = useCallback(async (toStatus: string) => {
    setForcing(true);
    setForceError(null);
    try {
      const result = await window.api.tasks.forceTransition(taskId, toStatus);
      if (result.success) {
        setForceDialogOpen(false);
        if (result.hookFailures?.length) {
          // Surface hook failures from force transition as inline alerts
          for (const f of result.hookFailures) {
            hookFailureAlerts.push(f);
          }
        }
        onTransition('__force_refresh__'); // Signal parent to refetch
      } else {
        setForceError(result.error ?? 'Force transition failed');
      }
    } catch (err) {
      setForceError(err instanceof Error ? err.message : 'Force transition failed');
    } finally {
      setForcing(false);
    }
  }, [taskId, onTransition, hookFailureAlerts]);

  const handleRetryHook = useCallback(async (hookName: string, from: string, to: string) => {
    const result = await retry(taskId, hookName, from, to);
    if (result.success) {
      refetchDiagnostics();
    }
    // Failure is surfaced via useHookRetry's lastResult state
  }, [taskId, retry, refetchDiagnostics]);

  const handleDismissFailure = useCallback((failureId: string) => {
    setDismissedFailureIds((prev) => new Set([...prev, failureId]));
  }, []);

  const handleAdvancePhase = useCallback(async () => {
    setAdvancingPhase(true);
    setAdvanceError(null);
    try {
      const result = await window.api.tasks.advancePhase(taskId);
      if (!result.success) {
        setAdvanceError(result.error ?? 'Phase advance failed');
      }
      refetchDiagnostics();
    } catch (err) {
      setAdvanceError(err instanceof Error ? err.message : 'Phase advance failed');
    } finally {
      setAdvancingPhase(false);
    }
  }, [taskId, refetchDiagnostics]);

  // Merge hook failure alerts from transitions with diagnostics hook failures
  const visibleHookFailures = (diagnostics?.recentHookFailures ?? [])
    .filter((f) => !dismissedFailureIds.has(f.id));

  // Determine enhanced terminal state messaging
  const enhancedStatusMeta = { ...statusMeta };
  const phases = diagnostics?.phases;
  const hasPendingPhases = phases?.some((p) => p.status === 'pending') ?? false;

  return (
    <>
      {/* Primary action bar */}
      <StatusActionBar
        task={task}
        isAgentPipeline={isAgentPipeline}
        hasRunningAgent={hasRunningAgent}
        activeRun={activeRun}
        lastRun={lastRun}
        isStuck={isStuck}
        isFinalizing={isFinalizing}
        primaryTransitions={primaryTransitions}
        transitioning={transitioning}
        stoppingAgent={stoppingAgent}
        statusMeta={enhancedStatusMeta}
        onTransition={onTransition}
        onStopAgent={onStopAgent}
        onNavigateToRun={onNavigateToRun}
        phases={phases ?? undefined}
        hasPendingPhases={hasPendingPhases}
        totalFailedRuns={diagnostics?.agentState.totalFailedRuns}
        onOpenForceDialog={() => setForceDialogOpen(true)}
      />

      {/* Inline hook failure alerts from transitions */}
      {hookFailureAlerts.length > 0 && (
        <div className="mb-4 space-y-2">
          {hookFailureAlerts.map((f, i) => (
            <div
              key={i}
              className="rounded-md px-4 py-3 flex items-start gap-3 text-sm"
              style={{ backgroundColor: '#fffbeb', border: '1px solid #fbbf2433' }}
            >
              <span style={{ color: '#d97706', marginTop: '2px' }}>&#9888;</span>
              <div className="flex-1">
                <span className="font-medium" style={{ color: '#d97706' }}>
                  Hook "{f.hook}" failed ({f.policy})
                </span>
                <p className="text-xs mt-1" style={{ color: '#d97706' }}>{f.error}</p>
              </div>
              <button
                className="text-muted-foreground hover:opacity-80 text-lg leading-none"
                onClick={() => onDismissHookAlert(i)}
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hook failures from diagnostics */}
      <HookFailureBanner
        failures={visibleHookFailures}
        retrying={retrying}
        onRetry={handleRetryHook}
        onDismiss={handleDismissFailure}
      />

      {/* Phase progress bar */}
      {phases && phases.length > 1 && (
        <>
          <PhaseProgressBar
            phases={phases}
            activePhaseIndex={diagnostics?.activePhaseIndex ?? -1}
            isStuck={diagnostics?.isStuck ?? false}
            stuckReason={diagnostics?.stuckReason}
            advancingPhase={advancingPhase}
            onAdvancePhase={handleAdvancePhase}
          />
          {advanceError && (
            <div
              className="mb-4 rounded-md px-4 py-2 text-xs"
              style={{ backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }}
            >
              Phase advance failed: {advanceError}
            </div>
          )}
        </>
      )}

      {/* Transition map */}
      {diagnostics?.allTransitions && (
        <TransitionMap
          allTransitions={diagnostics.allTransitions}
          transitioning={transitioning}
          onTransition={onTransition}
          onOpenForceDialog={() => setForceDialogOpen(true)}
        />
      )}

      {/* Force transition dialog */}
      <ForceTransitionDialog
        open={forceDialogOpen}
        onClose={() => setForceDialogOpen(false)}
        onForce={handleForceTransition}
        forcing={forcing}
        forceError={forceError}
        statuses={pipelineStatuses}
        currentStatus={task.status}
        taskId={taskId}
      />
    </>
  );
}
