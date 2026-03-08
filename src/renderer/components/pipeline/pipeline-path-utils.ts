import type { Pipeline, DebugTimelineEntry, AgentRun } from '../../../shared/types';

/** Compute the happy (default forward) path through a pipeline */
export function computeHappyPath(pipeline: Pipeline): string[] {
  const { statuses, transitions } = pipeline;
  if (statuses.length === 0) return [];

  const statusPosition = new Map(statuses.map((s, i) => [s.name, s.position ?? (900 + i)]));
  const path: string[] = [statuses[0].name];
  const visited = new Set<string>(path);

  while (true) {
    const current = path[path.length - 1];
    const currentDef = statuses.find((s) => s.name === current);
    if (currentDef?.isFinal) break;

    const candidates = transitions
      .filter((t) => t.from === current && !visited.has(t.to))
      .sort((a, b) => (statusPosition.get(a.to) ?? 999) - (statusPosition.get(b.to) ?? 999));

    if (candidates.length === 0) break;
    const next = candidates[0].to;
    path.push(next);
    visited.add(next);
  }
  return path;
}

/** Project forward from a status to the final status */
export function projectForward(
  from: string,
  pipeline: Pipeline,
  alreadyVisited: Set<string>,
): string[] {
  const { statuses, transitions } = pipeline;
  const statusPosition = new Map(statuses.map((s, i) => [s.name, s.position ?? (900 + i)]));
  const path: string[] = [];
  const visited = new Set(alreadyVisited);
  let current = from;

  while (true) {
    const currentDef = statuses.find((s) => s.name === current);
    if (currentDef?.isFinal) break;

    const candidates = transitions
      .filter((t) => t.from === current && !visited.has(t.to))
      .sort((a, b) => (statusPosition.get(a.to) ?? 999) - (statusPosition.get(b.to) ?? 999));

    if (candidates.length === 0) break;
    const next = candidates[0].to;
    path.push(next);
    visited.add(next);
    current = next;
  }
  return path;
}

/** Compute which statuses are agentic (have agent-triggered outbound transitions) */
export function computeAgenticStatuses(pipeline: Pipeline): Set<string> {
  const agentic = new Set<string>();
  for (const t of pipeline.transitions) {
    if (t.trigger === 'agent') agentic.add(t.from);
  }
  return agentic;
}

/**
 * Scan pipeline transitions for start_agent hooks and build a map of
 * statusName → agent modes that run in that status.
 */
export function computeStatusToModes(pipeline: Pipeline): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of pipeline.transitions) {
    if (!t.hooks) continue;
    for (const hook of t.hooks) {
      if (hook.name === 'start_agent' && hook.params?.mode) {
        const modes = map.get(t.to) ?? [];
        const mode = hook.params.mode as string;
        if (!modes.includes(mode)) modes.push(mode);
        map.set(t.to, modes);
      }
    }
  }
  return map;
}

/** Find the latest agent run matching any of the modes for a given status */
export function findLatestRunForStatus(
  statusName: string,
  statusToModes: Map<string, string[]>,
  agentRuns: AgentRun[],
): AgentRun | null {
  const modes = statusToModes.get(statusName);
  if (!modes || modes.length === 0) return null;
  return agentRuns.find((r) => modes.includes(r.mode)) ?? null;
}

/** Get ring box-shadow for agentic nodes */
export function agenticRing(color: string): string {
  return `0 0 0 3px ${color}40`;
}

/** Compute display path with skipped steps */
export function computeDisplayPath(
  pipeline: Pipeline,
  currentStatus: string,
  transitionEntries: DebugTimelineEntry[],
): { displayPath: string[]; currentIndex: number; skippedStatuses: Set<string> } {
  const sortedTransitions = [...transitionEntries]
    .filter((e) => !(e.data?.guardResults as Record<string, unknown> | undefined)?._denied)
    .sort((a, b) => a.timestamp - b.timestamp);
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
    const historyPath = [...collapsed];
    if (historyPath[historyPath.length - 1] !== currentStatus) {
      historyPath.push(currentStatus);
    }
    const currentIndex = historyPath.length - 1;

    const happyIdx = happyPath.indexOf(currentStatus);
    let future: string[];
    if (happyIdx >= 0) {
      future = happyPath.slice(happyIdx + 1);
    } else {
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

  if (happySet.has(currentStatus)) {
    const happyIndex = new Map(happyPath.map((s, i) => [s, i]));
    const currentHappyIdx = happyIndex.get(currentStatus)!;

    for (let i = 0; i < currentHappyIdx; i++) {
      if (!visitedSet.has(happyPath[i])) {
        skippedStatuses.add(happyPath[i]);
      }
    }

    const merged: string[] = [];
    const mergedSet = new Set<string>();
    let dedupedIdx = 0;

    for (let hi = 0; hi <= currentHappyIdx; hi++) {
      const hStep = happyPath[hi];
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

  const future = projectForward(currentStatus, pipeline, seen);
  const displayPath = [...deduped, ...future];
  const currentIndex = displayPath.indexOf(currentStatus);
  return { displayPath, currentIndex, skippedStatuses };
}
