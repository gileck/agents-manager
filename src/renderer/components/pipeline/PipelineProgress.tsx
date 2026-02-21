import React from 'react';
import type { Pipeline, DebugTimelineEntry } from '../../../shared/types';

/** Compute the happy (default forward) path through a pipeline */
function computeHappyPath(pipeline: Pipeline): string[] {
  const { statuses, transitions } = pipeline;
  if (statuses.length === 0) return [];

  const statusIndex = new Map(statuses.map((s, i) => [s.name, i]));
  const path: string[] = [statuses[0].name];
  const visited = new Set<string>(path);

  while (true) {
    const current = path[path.length - 1];
    const currentDef = statuses.find((s) => s.name === current);
    if (currentDef?.isFinal) break;

    // Find transitions from current to an unvisited status, pick lowest-index target
    const candidates = transitions
      .filter((t) => t.from === current && !visited.has(t.to))
      .sort((a, b) => (statusIndex.get(a.to) ?? 999) - (statusIndex.get(b.to) ?? 999));

    if (candidates.length === 0) break;
    const next = candidates[0].to;
    path.push(next);
    visited.add(next);
  }
  return path;
}

/** Project forward from a status to the final status */
function projectForward(
  from: string,
  pipeline: Pipeline,
  alreadyVisited: Set<string>,
): string[] {
  const { statuses, transitions } = pipeline;
  const statusIndex = new Map(statuses.map((s, i) => [s.name, i]));
  const path: string[] = [];
  const visited = new Set(alreadyVisited);
  let current = from;

  while (true) {
    const currentDef = statuses.find((s) => s.name === current);
    if (currentDef?.isFinal) break;

    const candidates = transitions
      .filter((t) => t.from === current && !visited.has(t.to))
      .sort((a, b) => (statusIndex.get(a.to) ?? 999) - (statusIndex.get(b.to) ?? 999));

    if (candidates.length === 0) break;
    const next = candidates[0].to;
    path.push(next);
    visited.add(next);
    current = next;
  }
  return path;
}

/** Compute which statuses are agentic (have agent-triggered outbound transitions) */
function computeAgenticStatuses(pipeline: Pipeline): Set<string> {
  const agentic = new Set<string>();
  for (const t of pipeline.transitions) {
    if (t.trigger === 'agent') agentic.add(t.from);
  }
  return agentic;
}

/** Get ring box-shadow for agentic nodes */
function agenticRing(color: string): string {
  return `0 0 0 3px ${color}40`;
}

/** Compute display path with skipped steps */
function computeDisplayPath(
  pipeline: Pipeline,
  currentStatus: string,
  transitionEntries: DebugTimelineEntry[],
): { displayPath: string[]; currentIndex: number; skippedStatuses: Set<string> } {
  const sortedTransitions = [...transitionEntries].sort((a, b) => a.timestamp - b.timestamp);
  const visitedStatuses: string[] = [];
  for (const entry of sortedTransitions) {
    const from = entry.data?.fromStatus as string | undefined;
    const to = entry.data?.toStatus as string | undefined;
    if (from && visitedStatuses.length === 0) visitedStatuses.push(from);
    if (from && visitedStatuses[visitedStatuses.length - 1] !== from) visitedStatuses.push(from);
    if (to) visitedStatuses.push(to);
  }

  const happyPath = computeHappyPath(pipeline);
  const happySet = new Set(happyPath);
  const visitedSet = new Set(visitedStatuses);
  const skippedStatuses = new Set<string>();

  if (visitedStatuses.length === 0) {
    let displayPath = happyPath;
    let currentIndex = displayPath.indexOf(currentStatus);
    if (currentIndex === -1) {
      displayPath = [currentStatus, ...happyPath.filter((s) => s !== currentStatus)];
      currentIndex = 0;
    }
    return { displayPath, currentIndex, skippedStatuses };
  }

  // Collapse consecutive duplicates (from self-transitions like retries)
  const collapsed: string[] = [];
  for (const s of visitedStatuses) {
    if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== s) {
      collapsed.push(s);
    }
  }

  // Check for loops: non-consecutive revisits (e.g. pr_review -> implementing)
  const seenOnce = new Set<string>();
  let hasLoops = false;
  for (const s of collapsed) {
    if (seenOnce.has(s)) { hasLoops = true; break; }
    seenOnce.add(s);
  }

  if (hasLoops) {
    // Show full history including loops so the revisit is visible
    const historyPath = [...collapsed];
    if (historyPath[historyPath.length - 1] !== currentStatus) {
      historyPath.push(currentStatus);
    }
    const currentIndex = historyPath.length - 1;

    // Project forward using happy path from current status
    const happyIdx = happyPath.indexOf(currentStatus);
    let future: string[];
    if (happyIdx >= 0) {
      future = happyPath.slice(happyIdx + 1);
    } else {
      // Fallback: project forward excluding already-shown statuses
      future = projectForward(currentStatus, pipeline, new Set(historyPath));
    }

    const displayPath = [...historyPath, ...future];
    return { displayPath, currentIndex, skippedStatuses };
  }

  // Dedup visited preserving order
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of visitedStatuses) {
    if (!seen.has(s)) { seen.add(s); deduped.push(s); }
  }
  if (!seen.has(currentStatus)) {
    deduped.push(currentStatus);
    seen.add(currentStatus);
  }

  // If current is in the happy path, merge visited with full happy path
  // to show skipped steps in their natural position
  if (happySet.has(currentStatus)) {
    const happyIndex = new Map(happyPath.map((s, i) => [s, i]));
    const currentHappyIdx = happyIndex.get(currentStatus)!;

    // Identify skipped: in happy path, before current, not visited
    for (let i = 0; i < currentHappyIdx; i++) {
      if (!visitedSet.has(happyPath[i])) {
        skippedStatuses.add(happyPath[i]);
      }
    }

    // Merge: walk happy path up to current, inserting extra visited
    // steps at the position they were first reached
    const merged: string[] = [];
    const mergedSet = new Set<string>();
    let dedupedIdx = 0;

    for (let hi = 0; hi <= currentHappyIdx; hi++) {
      const hStep = happyPath[hi];
      // Insert extra visited steps that came before this happy step
      while (dedupedIdx < deduped.length) {
        const ds = deduped[dedupedIdx];
        if (ds === hStep) break;
        if (happySet.has(ds) && (happyIndex.get(ds)! > hi)) break;
        if (!mergedSet.has(ds)) { merged.push(ds); mergedSet.add(ds); }
        dedupedIdx++;
      }
      if (!mergedSet.has(hStep)) { merged.push(hStep); mergedSet.add(hStep); }
      if (dedupedIdx < deduped.length && deduped[dedupedIdx] === hStep) dedupedIdx++;
    }
    // Append remaining visited steps
    for (; dedupedIdx < deduped.length; dedupedIdx++) {
      if (!mergedSet.has(deduped[dedupedIdx])) {
        merged.push(deduped[dedupedIdx]);
        mergedSet.add(deduped[dedupedIdx]);
      }
    }

    const future = projectForward(currentStatus, pipeline, mergedSet);
    const displayPath = [...merged, ...future];
    const currentIndex = displayPath.indexOf(currentStatus);
    return { displayPath, currentIndex, skippedStatuses };
  }

  // Fallback: current not in happy path (e.g. needs_info)
  const future = projectForward(currentStatus, pipeline, seen);
  const displayPath = [...deduped, ...future];
  const currentIndex = displayPath.indexOf(currentStatus);
  return { displayPath, currentIndex, skippedStatuses };
}

// ─── Cycle collapse ─────────────────────────────────────────────────────────

type SingleNode = { kind: 'single'; statusName: string; originalIndex: number };
type CycleNode = { kind: 'cycle'; implStatus: string; prStatus: string; count: number };
type DisplayNode = SingleNode | CycleNode;

/**
 * Detect repeated consecutive pairs (e.g. implementing→pr_review×N) in the
 * displayPath and collapse them into a single CycleNode when N≥2.
 */
function collapseIntoCycleGroups(
  displayPath: string[],
  currentIndex: number,
): { nodes: DisplayNode[]; adjustedCurrentIndex: number } {
  // Map each consecutive pair to the list of start positions where it occurs
  const pairMap = new Map<string, number[]>();
  for (let i = 0; i < displayPath.length - 1; i++) {
    const key = `${displayPath[i]}|${displayPath[i + 1]}`;
    if (!pairMap.has(key)) pairMap.set(key, []);
    pairMap.get(key)!.push(i);
  }

  // Pick the pair that repeats the most (must appear ≥2 times)
  let cyclePairKey: string | null = null;
  let cyclePositions: number[] = [];
  for (const [key, positions] of pairMap) {
    if (positions.length >= 2 && positions.length > cyclePositions.length) {
      cyclePairKey = key;
      cyclePositions = positions;
    }
  }

  if (!cyclePairKey) {
    return {
      nodes: displayPath.map((s, i) => ({ kind: 'single', statusName: s, originalIndex: i })),
      adjustedCurrentIndex: currentIndex,
    };
  }

  const pairParts = cyclePairKey.split('|');
  if (pairParts.length !== 2) {
    console.error(`PipelineProgress: unexpected cycle pair key "${cyclePairKey}", expected exactly one "|"`);
    return {
      nodes: displayPath.map((s, i) => ({ kind: 'single' as const, statusName: s, originalIndex: i })),
      adjustedCurrentIndex: currentIndex,
    };
  }
  const [implStatus, prStatus] = pairParts;
  const cycleStart = cyclePositions[0];
  const cycleEnd = cyclePositions[cyclePositions.length - 1] + 1; // inclusive last index

  const nodes: DisplayNode[] = [];
  for (let i = 0; i < cycleStart; i++) {
    nodes.push({ kind: 'single', statusName: displayPath[i], originalIndex: i });
  }
  const cycleNodeIdx = nodes.length;
  nodes.push({ kind: 'cycle', implStatus, prStatus, count: cyclePositions.length });
  for (let i = cycleEnd + 1; i < displayPath.length; i++) {
    nodes.push({ kind: 'single', statusName: displayPath[i], originalIndex: i });
  }

  let adjustedCurrentIndex: number;
  if (currentIndex < cycleStart) {
    adjustedCurrentIndex = currentIndex;
  } else if (currentIndex <= cycleEnd) {
    adjustedCurrentIndex = cycleNodeIdx;
  } else {
    adjustedCurrentIndex = cycleNodeIdx + 1 + (currentIndex - cycleEnd - 1);
  }

  return { nodes, adjustedCurrentIndex };
}

// ─── Connector ───────────────────────────────────────────────────────────────

function Connector({ completed, dashed }: { completed: boolean; dashed?: boolean }) {
  return (
    <div
      style={{
        width: 32,
        height: 2,
        flexShrink: 0,
        backgroundColor: dashed ? 'transparent' : (completed ? '#22c55e' : '#374151'),
        borderBottom: dashed ? '2px dashed #4b5563' : undefined,
      }}
    />
  );
}

// ─── CycleCapsule ─────────────────────────────────────────────────────────────

function SmallCycleNode({ color, isActive, agentState }: {
  color: string; isActive: boolean; agentState: 'idle' | 'running' | 'failed';
}) {
  return (
    <div style={{
      position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      width: 20, height: 20, borderRadius: '50%', backgroundColor: color,
      boxShadow: isActive ? `0 0 0 2px ${color}40` : undefined, flexShrink: 0,
    }}>
      {!isActive && (
        <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
          <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {isActive && agentState === 'running' && (
        <>
          <span style={{
            position: 'absolute', display: 'inline-flex', width: '100%', height: '100%',
            borderRadius: '50%', backgroundColor: color, opacity: 0.7,
            animation: 'ping 1s cubic-bezier(0,0,0.2,1) infinite',
          }} />
          <span style={{ position: 'relative', borderRadius: '50%', width: 7, height: 7, backgroundColor: '#fff' }} />
        </>
      )}
      {isActive && agentState !== 'running' && (
        <span style={{ borderRadius: '50%', width: 7, height: 7, backgroundColor: '#fff' }} />
      )}
    </div>
  );
}

function CycleCapsule({
  implLabel,
  prLabel,
  count,
  state,
  agentState,
}: {
  implLabel: string;
  prLabel: string;
  count: number;
  state: 'done' | 'active' | 'future';
  agentState: 'idle' | 'running' | 'failed';
}) {
  const borderColor = state === 'active' ? '#3b82f6' : state === 'done' ? '#16a34a' : '#374151';
  const nodeColor   = state === 'done' ? '#22c55e' : state === 'active' ? '#3b82f6' : '#374151';
  const arrowColor  = state === 'done' ? '#4ade80' : state === 'active' ? '#60a5fa' : '#4b5563';
  const countColor  = state === 'done' ? '#4ade80' : state === 'active' ? '#93c5fd' : '#6b7280';
  const countBg     = state === 'done' ? '#052e16' : state === 'active' ? '#172554' : '#1f2937';
  const labelColor  = state === 'done' ? '#16a34a' : state === 'active' ? '#2563eb' : '#6b7280';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
      {/* Compact capsule: node ⇒ node ×N */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 8px',
        borderRadius: 20,
        border: `1.5px solid ${borderColor}`,
        boxShadow: state === 'active' ? `0 0 0 3px rgba(59,130,246,0.15)` : undefined,
      }}>
        <SmallCycleNode color={nodeColor} isActive={state === 'active'} agentState={agentState} />
        <span style={{ fontSize: 11, color: arrowColor }}>⇒</span>
        <SmallCycleNode color={nodeColor} isActive={state === 'active'} agentState={agentState} />
        <span style={{
          display: 'inline-flex', alignItems: 'center',
          background: countBg, color: countColor,
          borderRadius: 99, fontSize: 10, fontWeight: 700,
          padding: '0 5px', lineHeight: 1.5,
        }}>
          ×{count}
        </span>
      </div>
      {/* Single label line */}
      <span style={{ fontSize: 10, fontWeight: 500, color: labelColor, whiteSpace: 'nowrap' }}>
        {implLabel} / {prLabel}
      </span>
    </div>
  );
}

/** Pipeline progress visualization */
export function PipelineProgress({
  pipeline,
  currentStatus,
  transitionEntries,
  agentState = 'idle',
}: {
  pipeline: Pipeline;
  currentStatus: string;
  transitionEntries: DebugTimelineEntry[];
  agentState?: 'idle' | 'running' | 'failed';
}) {
  const statusLabelMap = new Map(pipeline.statuses.map((s) => [s.name, s.label]));
  const agenticStatuses = computeAgenticStatuses(pipeline);
  const { displayPath, currentIndex, skippedStatuses } = computeDisplayPath(pipeline, currentStatus, transitionEntries);

  // Collapse repeated pairs into cycle capsules
  const { nodes, adjustedCurrentIndex } = collapseIntoCycleGroups(displayPath, currentIndex);

  return (
    <div style={{ padding: '16px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 0, overflowX: 'auto' }}>
        {nodes.map((node, nodeIdx) => {
          const isFirst = nodeIdx === 0;
          const prevNode = nodeIdx > 0 ? nodes[nodeIdx - 1] : null;

          if (node.kind === 'cycle') {
            const isDone = nodeIdx < adjustedCurrentIndex;
            const isActive = nodeIdx === adjustedCurrentIndex;
            const state = isDone ? 'done' : isActive ? 'active' : 'future';

            // Connector color: completed if previous single node is done
            const connectorDone = prevNode !== null && (
              prevNode.kind === 'single'
                ? !skippedStatuses.has(prevNode.statusName) && prevNode.originalIndex < currentIndex
                : nodeIdx - 1 < adjustedCurrentIndex
            );

            return (
              <React.Fragment key={`cycle-${nodeIdx}`}>
                {!isFirst && <Connector completed={connectorDone} />}
                <CycleCapsule
                  implLabel={statusLabelMap.get(node.implStatus) ?? node.implStatus}
                  prLabel={statusLabelMap.get(node.prStatus) ?? node.prStatus}
                  count={node.count}
                  state={state}
                  agentState={agentState}
                />
              </React.Fragment>
            );
          }

          // Single node
          const { statusName, originalIndex: i } = node;
          const isSkipped = skippedStatuses.has(statusName);
          const isCompleted = !isSkipped && i < currentIndex;
          const isCurrent = i === currentIndex;
          const isFuture = !isSkipped && i > currentIndex;
          const label = statusLabelMap.get(statusName) ?? statusName;
          const isAgentic = agenticStatuses.has(statusName);
          const statusDef = pipeline.statuses.find((s) => s.name === statusName);
          const isFinalCurrent = isCurrent && statusDef?.isFinal;

          const nodeColor = isSkipped ? '#4b5563'
            : isCompleted || isFinalCurrent ? '#22c55e'
            : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#3b82f6')
            : '#374151';

          // Connector: check if previous node was skipped or is a cycle
          const prevSkipped = prevNode?.kind === 'single' && skippedStatuses.has(prevNode.statusName);
          const connectorSkipped = isSkipped || prevSkipped;
          const connectorDone = !connectorSkipped && i <= currentIndex && i > 0;

          return (
            <React.Fragment key={`${statusName}-${nodeIdx}`}>
              {!isFirst && (
                <Connector completed={connectorDone} dashed={connectorSkipped} />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 64, opacity: isSkipped ? 0.5 : 1 }}>
                <div
                  style={{
                    position: 'relative',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: '50%',
                    width: isSkipped ? 22 : 28,
                    height: isSkipped ? 22 : 28,
                    backgroundColor: nodeColor,
                    boxShadow: isAgentic && !isSkipped ? agenticRing(nodeColor) : undefined,
                  }}
                >
                  {(isCompleted || isFinalCurrent) && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 7l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {isSkipped && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M3 6h6" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
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
                      <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', width: 10, height: 10, backgroundColor: '#fff' }} />
                    </>
                  )}
                  {isCurrent && !isFinalCurrent && agentState === 'idle' && (
                    <span style={{ display: 'inline-flex', borderRadius: '50%', width: 10, height: 10, backgroundColor: '#fff' }} />
                  )}
                  {isCurrent && !isFinalCurrent && agentState === 'failed' && (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M4 4l6 6M10 4l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  )}
                  {isFuture && (
                    <span style={{ borderRadius: '50%', width: 10, height: 10, backgroundColor: '#9ca3af' }} />
                  )}
                </div>
                <span
                  style={{
                    fontSize: 10, fontWeight: 500, textAlign: 'center', whiteSpace: 'nowrap',
                    color: isSkipped ? '#6b7280'
                      : isCompleted || isFinalCurrent ? '#16a34a'
                      : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#2563eb')
                      : '#6b7280',
                    textDecoration: isSkipped ? 'line-through' : undefined,
                  }}
                >
                  {label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
