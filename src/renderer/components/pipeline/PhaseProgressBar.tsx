import React from 'react';
import { Button } from '../ui/button';
import type { ImplementationPhase } from '../../../shared/types';

interface PhaseProgressBarProps {
  phases: ImplementationPhase[];
  activePhaseIndex: number;
  isStuck: boolean;
  stuckReason?: string;
  advancingPhase: boolean;
  onAdvancePhase: () => void;
}

const PHASE_COLORS = {
  completed: '#22c55e',
  in_progress: '#3b82f6',
  pending: '#d1d5db',
  stuck: '#f59e0b',
};

export function PhaseProgressBar({
  phases,
  activePhaseIndex,
  isStuck,
  stuckReason,
  advancingPhase,
  onAdvancePhase,
}: PhaseProgressBarProps) {
  if (!phases || phases.length <= 1) return null;

  const completedCount = phases.filter((p) => p.status === 'completed').length;
  const currentPhase = activePhaseIndex >= 0 ? phases[activePhaseIndex] : null;
  const allComplete = completedCount === phases.length;
  const hasPending = phases.some((p) => p.status === 'pending');

  return (
    <div className="mb-4 rounded-md border px-4 py-3">
      {/* Phase label */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">
          {allComplete
            ? `All ${phases.length} phases complete`
            : currentPhase
              ? `Phase ${activePhaseIndex + 1} of ${phases.length}: ${currentPhase.name}`
              : `${completedCount} of ${phases.length} phases complete`}
        </span>
        {isStuck && hasPending && (
          <Button
            variant="outline"
            size="sm"
            disabled={advancingPhase}
            onClick={onAdvancePhase}
            style={{ borderColor: PHASE_COLORS.stuck, color: PHASE_COLORS.stuck }}
          >
            {advancingPhase ? 'Advancing...' : 'Advance Phase'}
          </Button>
        )}
      </div>

      {/* Segmented bar */}
      <div className="flex gap-1" style={{ height: '8px' }}>
        {phases.map((phase) => {
          let color: string;
          let animate = false;
          if (phase.status === 'completed') {
            color = PHASE_COLORS.completed;
          } else if (phase.status === 'in_progress') {
            color = isStuck ? PHASE_COLORS.stuck : PHASE_COLORS.in_progress;
            animate = !isStuck;
          } else {
            color = PHASE_COLORS.pending;
          }

          return (
            <div
              key={phase.id}
              className={`flex-1 rounded-sm ${animate ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: color }}
              title={`${phase.name}: ${phase.status}${phase.prLink ? ' (has PR)' : ''}`}
            />
          );
        })}
      </div>

      {/* Stuck reason */}
      {isStuck && stuckReason && (
        <p className="text-xs mt-2" style={{ color: PHASE_COLORS.stuck }}>
          {stuckReason}
        </p>
      )}
    </div>
  );
}
