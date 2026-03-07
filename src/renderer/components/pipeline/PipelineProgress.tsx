import React from 'react';
import type { Pipeline, DebugTimelineEntry, AgentRun, ImplementationPhase } from '../../../shared/types';
import {
  computeAgenticStatuses,
  computeStatusToModes,
  findLatestRunForStatus,
  agenticRing,
  computeDisplayPath,
} from './pipeline-path-utils';
import {
  groupIntoPhases,
  computeMergedPhaseState,
  type PhaseNode,
  type StandalonePhaseNode,
  type MergedPhaseVisualState,
} from './phase-grouping';

// ─── Connector ───────────────────────────────────────────────────────────────

function Connector({ completed }: { completed: boolean }) {
  return (
    <div
      style={{
        width: 20,
        height: 2,
        flexShrink: 0,
        backgroundColor: completed ? '#22c55e' : '#374151',
      }}
    />
  );
}

// ─── SVG icons ───────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <path d="M4 4l6 6M10 4l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
      <ellipse cx="7" cy="7" rx="5.5" ry="3.5" stroke="#fff" strokeWidth="1.5" />
      <circle cx="7" cy="7" r="1.8" fill="#fff" />
    </svg>
  );
}

// ─── Visual state helpers ────────────────────────────────────────────────────

function circleColorForState(state: MergedPhaseVisualState): string {
  switch (state) {
    case 'future': return '#374151';
    case 'work_idle':
    case 'work_running': return '#3b82f6';
    case 'work_failed': return '#ef4444';
    case 'in_review': return '#8b5cf6';
    case 'completed': return '#22c55e';
  }
}

function labelColorForState(state: MergedPhaseVisualState): string {
  switch (state) {
    case 'future': return '#6b7280';
    case 'work_idle':
    case 'work_running': return '#2563eb';
    case 'work_failed': return '#ef4444';
    case 'in_review': return '#7c3aed';
    case 'completed': return '#16a34a';
  }
}

function circleContentForState(state: MergedPhaseVisualState, circleColor: string) {
  switch (state) {
    case 'future':
      return <span style={{ borderRadius: '50%', width: 8, height: 8, backgroundColor: '#9ca3af' }} />;
    case 'work_idle':
      return <span style={{ display: 'inline-flex', borderRadius: '50%', width: 8, height: 8, backgroundColor: '#fff' }} />;
    case 'work_running':
      return (
        <>
          <span
            style={{
              position: 'absolute', display: 'inline-flex',
              width: '100%', height: '100%', borderRadius: '50%',
              backgroundColor: circleColor, opacity: 0.75,
              animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite',
            }}
          />
          <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', width: 8, height: 8, backgroundColor: '#fff' }} />
        </>
      );
    case 'work_failed':
      return <XIcon />;
    case 'in_review':
      return <EyeIcon />;
    case 'completed':
      return <CheckIcon />;
  }
}

// ─── Phase node rendering ────────────────────────────────────────────────────

function renderStandaloneNode(
  phase: StandalonePhaseNode,
  phaseIdx: number,
  currentPhaseIndex: number,
  pipeline: Pipeline,
  agentState: 'idle' | 'running' | 'failed',
  agenticStatuses: Set<string>,
  statusToModes: Map<string, string[]>,
  agentRuns: AgentRun[] | null | undefined,
  onNavigateToRun: ((runId: string) => void) | undefined,
) {
  const isCompleted = phaseIdx < currentPhaseIndex;
  const isCurrent = phaseIdx === currentPhaseIndex;
  const isFuture = phaseIdx > currentPhaseIndex;
  const isAgentic = agenticStatuses.has(phase.statusName);
  const statusDef = pipeline.statuses.find((s) => s.name === phase.statusName);
  const isFinalCurrent = isCurrent && statusDef?.isFinal;

  const nodeColor = isCompleted || isFinalCurrent ? '#22c55e'
    : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#3b82f6')
    : '#374151';

  const matchedRun = isAgentic && agentRuns?.length
    ? findLatestRunForStatus(phase.statusName, statusToModes, agentRuns)
    : null;
  const nodeClickable = !!matchedRun && !!onNavigateToRun;

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 56,
        ...(nodeClickable ? { cursor: 'pointer' } : {}),
      }}
      title={nodeClickable ? 'View agent run' : undefined}
      onClick={nodeClickable ? () => onNavigateToRun!(matchedRun!.id) : undefined}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', width: 22, height: 22,
          backgroundColor: nodeColor,
          boxShadow: isAgentic ? agenticRing(nodeColor) : undefined,
        }}
      >
        {(isCompleted || isFinalCurrent) && <CheckIcon />}
        {isCurrent && !isFinalCurrent && agentState === 'running' && (
          <>
            <span
              style={{
                position: 'absolute', display: 'inline-flex',
                width: '100%', height: '100%', borderRadius: '50%',
                backgroundColor: '#3b82f6', opacity: 0.75,
                animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite',
              }}
            />
            <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', width: 8, height: 8, backgroundColor: '#fff' }} />
          </>
        )}
        {isCurrent && !isFinalCurrent && agentState === 'idle' && (
          <span style={{ display: 'inline-flex', borderRadius: '50%', width: 8, height: 8, backgroundColor: '#fff' }} />
        )}
        {isCurrent && !isFinalCurrent && agentState === 'failed' && <XIcon />}
        {isFuture && (
          <span style={{ borderRadius: '50%', width: 8, height: 8, backgroundColor: '#9ca3af' }} />
        )}
      </div>
      <span
        style={{
          fontSize: 9, fontWeight: 500, textAlign: 'center', whiteSpace: 'nowrap',
          color: isCompleted || isFinalCurrent ? '#16a34a'
            : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#2563eb')
            : '#6b7280',
          ...(nodeClickable ? { borderBottom: '1px dotted currentColor' } : {}),
        }}
      >
        {phase.label}
      </span>
    </div>
  );
}

function renderMergedNode(
  phase: PhaseNode & { kind: 'merged' },
  phaseIdx: number,
  currentPhaseIndex: number,
  currentStatus: string,
  agentState: 'idle' | 'running' | 'failed',
  agenticStatuses: Set<string>,
  statusToModes: Map<string, string[]>,
  agentRuns: AgentRun[] | null | undefined,
  onNavigateToRun: ((runId: string) => void) | undefined,
  implPhases?: ImplementationPhase[] | null,
) {
  const visualState = computeMergedPhaseState(phase, currentStatus, agentState, currentPhaseIndex, phaseIdx);
  const circleColor = circleColorForState(visualState);
  const labelColor = labelColorForState(visualState);
  const isAgentic = agenticStatuses.has(phase.workStatus) || agenticStatuses.has(phase.reviewStatus);

  const matchedRun = agentRuns?.length
    ? (findLatestRunForStatus(phase.workStatus, statusToModes, agentRuns)
      ?? findLatestRunForStatus(phase.reviewStatus, statusToModes, agentRuns))
    : null;
  const nodeClickable = !!matchedRun && !!onNavigateToRun;

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 56,
        ...(nodeClickable ? { cursor: 'pointer' } : {}),
      }}
      title={nodeClickable ? 'View agent run' : undefined}
      onClick={nodeClickable ? () => onNavigateToRun!(matchedRun!.id) : undefined}
    >
      <div
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '50%', width: 22, height: 22,
          backgroundColor: circleColor,
          boxShadow: isAgentic ? agenticRing(circleColor) : undefined,
        }}
      >
        {circleContentForState(visualState, circleColor)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span
            style={{
              fontSize: 9, fontWeight: 500, textAlign: 'center', whiteSpace: 'nowrap',
              color: labelColor,
              ...(nodeClickable ? { borderBottom: '1px dotted currentColor' } : {}),
            }}
          >
            {phase.label}
          </span>
          {phase.cycleCount > 1 && (
            <span
              style={{
                fontSize: 9, fontWeight: 700,
                color: labelColor,
                backgroundColor: `${circleColor}20`,
                borderRadius: 99, padding: '0 3px', lineHeight: '14px',
              }}
            >
              x{phase.cycleCount}
            </span>
          )}
        </div>
        {implPhases && implPhases.length > 1 && phase.workStatus === 'implementing' && (() => {
          const activeIdx = implPhases.findIndex(p => p.status === 'in_progress');
          const completedCount = implPhases.filter(p => p.status === 'completed').length;
          if (activeIdx < 0 && completedCount === implPhases.length) return null;
          const phaseNum = activeIdx >= 0 ? activeIdx + 1 : completedCount + 1;
          return (
            <span style={{ fontSize: 9, color: labelColor, opacity: 0.8 }}>
              Phase {phaseNum}/{implPhases.length}
            </span>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

/** Pipeline progress visualization */
export function PipelineProgress({
  pipeline,
  currentStatus,
  transitionEntries,
  agentState = 'idle',
  agentRuns,
  onNavigateToRun,
  implPhases,
}: {
  pipeline: Pipeline;
  currentStatus: string;
  transitionEntries: DebugTimelineEntry[];
  agentState?: 'idle' | 'running' | 'failed';
  agentRuns?: AgentRun[] | null;
  onNavigateToRun?: (runId: string) => void;
  implPhases?: ImplementationPhase[] | null;
}) {
  const statusLabelMap = new Map(pipeline.statuses.map((s) => [s.name, s.label]));
  const agenticStatuses = computeAgenticStatuses(pipeline);
  const statusToModes = computeStatusToModes(pipeline);
  const { displayPath, currentIndex, skippedStatuses } = computeDisplayPath(pipeline, currentStatus, transitionEntries);

  const { phases, currentPhaseIndex } = groupIntoPhases(displayPath, currentIndex, skippedStatuses, statusLabelMap);

  return (
    <div style={{ padding: '6px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 0, overflowX: 'auto' }}>
        {phases.map((phase, phaseIdx) => {
          const isFirst = phaseIdx === 0;
          const connectorCompleted = phaseIdx > 0 && phaseIdx <= currentPhaseIndex;

          return (
            <React.Fragment key={phase.kind === 'standalone' ? phase.statusName : `${phase.workStatus}-${phase.reviewStatus}`}>
              {!isFirst && <Connector completed={connectorCompleted} />}
              {phase.kind === 'standalone'
                ? renderStandaloneNode(
                    phase, phaseIdx, currentPhaseIndex, pipeline,
                    agentState, agenticStatuses, statusToModes, agentRuns, onNavigateToRun,
                  )
                : renderMergedNode(
                    phase, phaseIdx, currentPhaseIndex, currentStatus,
                    agentState, agenticStatuses, statusToModes, agentRuns, onNavigateToRun,
                    implPhases,
                  )
              }
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
