import React from 'react';
import { Card, CardContent } from '../ui/card';
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

  return (
    <Card className="mt-4">
      <CardContent className="py-6">
        <div className="flex flex-wrap items-center gap-y-4">
          {displayPath.map((statusName, i) => {
            const isSkipped = skippedStatuses.has(statusName);
            const isCompleted = !isSkipped && i < currentIndex;
            const isCurrent = i === currentIndex;
            const isFuture = !isSkipped && i > currentIndex;
            const label = statusLabelMap.get(statusName) ?? statusName;
            const isAgentic = agenticStatuses.has(statusName);
            const statusDef = pipeline.statuses.find((s) => s.name === statusName);
            const isFinalCurrent = isCurrent && statusDef?.isFinal;

            // Node color
            const nodeColor = isSkipped ? '#d1d5db'
              : isCompleted || isFinalCurrent ? '#22c55e'
              : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#3b82f6')
              : '#d1d5db';

            // Connector: gray dashed if adjacent to skipped step
            const prevSkipped = i > 0 && skippedStatuses.has(displayPath[i - 1]);
            const connectorSkipped = isSkipped || prevSkipped;

            return (
              <React.Fragment key={`${statusName}-${i}`}>
                {/* Connector line */}
                {i > 0 && (
                  <div
                    className="flex-shrink-0"
                    style={{
                      width: 32,
                      height: 2,
                      backgroundColor: connectorSkipped ? 'transparent' : (i <= currentIndex ? '#22c55e' : '#d1d5db'),
                      borderBottom: connectorSkipped ? '2px dashed #d1d5db' : undefined,
                    }}
                  />
                )}
                {/* Node */}
                <div className="flex flex-col items-center gap-1.5" style={{ minWidth: 64, opacity: isSkipped ? 0.5 : 1 }}>
                  <div
                    className="relative flex items-center justify-center rounded-full"
                    style={{
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
                          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                          style={{ backgroundColor: '#3b82f6' }}
                        />
                        <span
                          className="relative inline-flex rounded-full"
                          style={{ width: 10, height: 10, backgroundColor: '#fff' }}
                        />
                      </>
                    )}
                    {isCurrent && !isFinalCurrent && agentState === 'idle' && (
                      <span
                        className="relative inline-flex rounded-full"
                        style={{ width: 10, height: 10, backgroundColor: '#fff' }}
                      />
                    )}
                    {isCurrent && !isFinalCurrent && agentState === 'failed' && (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M4 4l6 6M10 4l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                    {isFuture && (
                      <span
                        className="rounded-full"
                        style={{ width: 10, height: 10, backgroundColor: '#9ca3af' }}
                      />
                    )}
                  </div>
                  <span
                    className="text-xs font-medium text-center"
                    style={{
                      color: isSkipped ? '#9ca3af'
                        : isCompleted || isFinalCurrent ? '#16a34a'
                        : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#2563eb')
                        : '#9ca3af',
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
      </CardContent>
    </Card>
  );
}
