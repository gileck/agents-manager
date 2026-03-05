/**
 * Phase grouping logic for the pipeline progress bar.
 *
 * Merges work/review status pairs into single phase nodes and hides
 * excluded statuses (like needs_info) to produce a compact display.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

// Status names must match the seeded AGENT_PIPELINE statuses in src/core/services/pipeline-engine.ts.
// If a pipeline status is renamed there, update the corresponding entry here.
export const PHASE_PAIRS = [
  { work: 'investigating', review: 'investigation_review', label: 'Investigation' },
  { work: 'designing', review: 'design_review', label: 'Design' },
  { work: 'planning', review: 'plan_review', label: 'Plan' },
  { work: 'implementing', review: 'pr_review', label: 'Implementation' },
] as const;

export const EXCLUDED_STATUSES = new Set(['needs_info', 'closed', 'workflow_review']);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StandalonePhaseNode {
  kind: 'standalone';
  statusName: string;
  label: string;
}

export interface MergedPhaseNode {
  kind: 'merged';
  workStatus: string;
  reviewStatus: string;
  label: string;
  /** Number of work→review cycles (for implementing/pr_review loops) */
  cycleCount: number;
}

export type PhaseNode = StandalonePhaseNode | MergedPhaseNode;

export type MergedPhaseVisualState =
  | 'future'
  | 'work_idle'
  | 'work_running'
  | 'work_failed'
  | 'in_review'
  | 'completed';

// ─── Lookup helpers ──────────────────────────────────────────────────────────

type PhasePair = (typeof PHASE_PAIRS)[number];
const workToReview = new Map<string, PhasePair>(PHASE_PAIRS.map((p) => [p.work, p]));
const reviewToWork = new Map<string, PhasePair>(PHASE_PAIRS.map((p) => [p.review, p]));

function phasePairFor(statusName: string) {
  return workToReview.get(statusName) ?? reviewToWork.get(statusName) ?? null;
}

// ─── groupIntoPhases ─────────────────────────────────────────────────────────

export function groupIntoPhases(
  displayPath: string[],
  currentIndex: number,
  skippedStatuses: Set<string>,
  statusLabelMap: Map<string, string>,
): { phases: PhaseNode[]; currentPhaseIndex: number } {
  const phases: PhaseNode[] = [];
  // Track which statuses have been consumed by a merged node
  const consumed = new Set<string>();
  let currentPhaseIndex = -1;

  for (let i = 0; i < displayPath.length; i++) {
    const statusName = displayPath[i];

    // Skip excluded and skipped statuses
    if (EXCLUDED_STATUSES.has(statusName) || skippedStatuses.has(statusName)) continue;
    // Already consumed by a merged node
    if (consumed.has(statusName)) continue;

    const pair = phasePairFor(statusName);

    if (pair) {
      // This status belongs to a work/review pair — merge them
      const workInPath = displayPath.includes(pair.work) && !skippedStatuses.has(pair.work);
      const reviewInPath = displayPath.includes(pair.review) && !skippedStatuses.has(pair.review);

      if (workInPath || reviewInPath) {
        const cycleCount = 1;

        phases.push({
          kind: 'merged',
          workStatus: pair.work,
          reviewStatus: pair.review,
          label: pair.label,
          cycleCount,
        });
        consumed.add(pair.work);
        consumed.add(pair.review);

        // Determine if current status falls within this phase
        if (currentPhaseIndex === -1) {
          if (statusName === displayPath[currentIndex]) {
            currentPhaseIndex = phases.length - 1;
          } else {
            // Check if the partner is the current status
            const partner = statusName === pair.work ? pair.review : pair.work;
            if (partner === displayPath[currentIndex]) {
              currentPhaseIndex = phases.length - 1;
            }
          }
        }
        continue;
      }
    }

    // Standalone node
    consumed.add(statusName);
    phases.push({
      kind: 'standalone',
      statusName,
      label: statusLabelMap.get(statusName) ?? statusName,
    });

    if (currentPhaseIndex === -1 && i === currentIndex) {
      currentPhaseIndex = phases.length - 1;
    }
  }

  // Fallback: if currentPhaseIndex wasn't set during iteration (e.g. current
  // status was consumed by a merged node encountered at a different index, or
  // the status was in a loop), scan all phases to find it.
  if (currentPhaseIndex === -1) {
    const currentStatus = displayPath[currentIndex];
    for (let pi = 0; pi < phases.length; pi++) {
      const phase = phases[pi];
      if (phase.kind === 'standalone' && phase.statusName === currentStatus) {
        currentPhaseIndex = pi;
        break;
      }
      if (phase.kind === 'merged' && (phase.workStatus === currentStatus || phase.reviewStatus === currentStatus)) {
        currentPhaseIndex = pi;
        break;
      }
    }
  }

  // If still unresolved (current status excluded or out-of-bounds), default to
  // first phase so the bar doesn't render everything as future.
  if (currentPhaseIndex === -1 && phases.length > 0) {
    currentPhaseIndex = 0;
  }

  return { phases, currentPhaseIndex };
}

// ─── computeMergedPhaseState ─────────────────────────────────────────────────

export function computeMergedPhaseState(
  node: MergedPhaseNode,
  currentStatus: string,
  agentState: 'idle' | 'running' | 'failed',
  currentPhaseIndex: number,
  thisPhaseIndex: number,
): MergedPhaseVisualState {
  // This phase is after the current phase — future
  if (thisPhaseIndex > currentPhaseIndex) return 'future';

  // This phase is before the current phase — completed
  if (thisPhaseIndex < currentPhaseIndex) return 'completed';

  // This is the current phase — determine sub-state
  if (currentStatus === node.reviewStatus) return 'in_review';
  if (currentStatus === node.workStatus) {
    if (agentState === 'running') return 'work_running';
    if (agentState === 'failed') return 'work_failed';
    return 'work_idle';
  }

  // Fallback: current status is in this merged phase but not directly matching
  // (shouldn't happen in practice)
  return 'work_idle';
}
