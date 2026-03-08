import React, { useState, useCallback } from 'react';
import { StatusActionBar } from './StatusActionBar';
import { ForceTransitionDialog } from './ForceTransitionDialog';
import type { AgentRun, Transition, PipelineStatus, HookFailure, PipelineDiagnostics } from '../../../shared/types';
import type { StatusMeta } from '../../hooks/usePipelineStatusMeta';

interface PipelineControlPanelProps {
  taskId: string;
  task: { status: string; prLink?: string | null };
  isAgentPipeline: boolean;
  hasRunningAgent: boolean;
  lastRun: AgentRun | null;
  isStuck: boolean;
  isFinalizing: boolean;
  primaryTransitions: Transition[];
  transitioning: string | null;
  statusMeta: StatusMeta;
  pipelineStatuses: PipelineStatus[];
  onTransition: (toStatus: string) => void;
  onNavigateToRun: (runId: string) => void;
  onHookFailures: (failures: HookFailure[]) => void;
  diagnostics: PipelineDiagnostics | null;
  refetchDiagnostics: () => void;
}

export function PipelineControlPanel({
  taskId,
  task,
  isAgentPipeline,
  hasRunningAgent,
  lastRun,
  isStuck,
  isFinalizing,
  primaryTransitions,
  transitioning,
  statusMeta,
  pipelineStatuses,
  onTransition,
  onNavigateToRun,
  onHookFailures,
  diagnostics,
  refetchDiagnostics,
}: PipelineControlPanelProps) {
  const [forceDialogOpen, setForceDialogOpen] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [forceError, setForceError] = useState<string | null>(null);

  const handleForceTransition = useCallback(async (toStatus: string) => {
    setForcing(true);
    setForceError(null);
    try {
      const result = await window.api.tasks.forceTransition(taskId, toStatus, 'admin');
      if (result.success) {
        setForceDialogOpen(false);
        if (result.hookFailures?.length) {
          onHookFailures(result.hookFailures);
        }
        refetchDiagnostics();
        onTransition('__force_refresh__'); // Signal parent to refetch
      } else {
        setForceError(result.error ?? 'Force transition failed');
      }
    } catch (err) {
      setForceError(err instanceof Error ? err.message : 'Force transition failed');
    } finally {
      setForcing(false);
    }
  }, [taskId, onTransition, onHookFailures, refetchDiagnostics]);

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
        lastRun={lastRun}
        isStuck={isStuck}
        isFinalizing={isFinalizing}
        primaryTransitions={primaryTransitions}
        transitioning={transitioning}
        statusMeta={enhancedStatusMeta}
        onTransition={onTransition}
        onNavigateToRun={onNavigateToRun}
        phases={phases ?? undefined}
        hasPendingPhases={hasPendingPhases}
        totalFailedRuns={diagnostics?.agentState.totalFailedRuns}
        onOpenForceDialog={() => setForceDialogOpen(true)}
      />

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
