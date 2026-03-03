import React, { useState } from 'react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import type { Pipeline, DebugTimelineEntry } from '../../../shared/types';
import { computeAgenticStatuses, agenticRing, computeDisplayPath } from './pipeline-path-utils';

/** Build a map of status details indexed by position in the display path */
function buildPositionDetailsMap(
  displayPath: string[],
  transitionEntries: DebugTimelineEntry[],
): Map<number, { timestamp: number; trigger?: string; guardResults?: unknown; duration?: number }> {
  const sorted = [...transitionEntries].sort((a, b) => a.timestamp - b.timestamp);
  const result = new Map<number, { timestamp: number; trigger?: string; guardResults?: unknown; duration?: number }>();

  let pathPos = 0;
  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];
    const toStatus = entry.data?.toStatus as string | undefined;
    if (!toStatus) continue;

    // Find next matching position in display path
    let matchPos = pathPos + 1;
    while (matchPos < displayPath.length && displayPath[matchPos] !== toStatus) {
      matchPos++;
    }
    if (matchPos >= displayPath.length) continue;

    const nextTimestamp = i + 1 < sorted.length ? sorted[i + 1].timestamp : undefined;
    const duration = nextTimestamp != null ? nextTimestamp - entry.timestamp : undefined;

    result.set(matchPos, {
      timestamp: entry.timestamp,
      trigger: entry.data?.trigger as string | undefined,
      guardResults: entry.data?.guardResults,
      duration,
    });

    pathPos = matchPos;
  }

  return result;
}

/** Format a duration in ms to a human-readable string */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

/** Format a timestamp to HH:MM:SS.mmm */
function formatTime(ts: number): string {
  if (ts === 0) return '--:--:--.---';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

/** Vertical pipeline with collapsible step details */
export function PipelineVertical({
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
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const statusLabelMap = new Map(pipeline.statuses.map((s) => [s.name, s.label]));
  const agenticStatuses = computeAgenticStatuses(pipeline);
  const { displayPath, currentIndex, skippedStatuses } = computeDisplayPath(pipeline, currentStatus, transitionEntries);
  const positionDetailsMap = buildPositionDetailsMap(displayPath, transitionEntries);

  const toggleStep = (idx: number) => {
    const next = new Set(expandedSteps);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    setExpandedSteps(next);
  };

  return (
    <Card className="mt-4">
      <CardContent className="py-6">
        <div className="flex flex-col">
          {displayPath.map((statusName, i) => {
            const isSkipped = skippedStatuses.has(statusName);
            const isCompleted = !isSkipped && i < currentIndex;
            const isCurrent = i === currentIndex;
            const isFuture = !isSkipped && i > currentIndex;
            const label = statusLabelMap.get(statusName) ?? statusName;
            const isAgentic = agenticStatuses.has(statusName);
            const statusDef = pipeline.statuses.find((s) => s.name === statusName);
            const isFinalCurrent = isCurrent && statusDef?.isFinal;
            const details = positionDetailsMap.get(i);
            const hasDetails = !isSkipped && (isCompleted || isFinalCurrent || (isCurrent && details));
            const expanded = expandedSteps.has(i);

            // Node color
            const nodeColor = isSkipped ? '#d1d5db'
              : isCompleted || isFinalCurrent ? '#22c55e'
              : isCurrent ? (agentState === 'failed' ? '#ef4444' : '#3b82f6')
              : '#d1d5db';

            // Connector: dashed if adjacent to skipped step
            const nextSkipped = i + 1 < displayPath.length && skippedStatuses.has(displayPath[i + 1]);
            const connectorDashed = isSkipped || nextSkipped;

            // For current step, compute live duration
            const currentDuration = isCurrent && !isFinalCurrent && details
              ? Date.now() - details.timestamp
              : undefined;

            return (
              <div key={`${statusName}-${i}`} className="flex" style={{ opacity: isSkipped ? 0.5 : 1 }}>
                {/* Left column: node + connector */}
                <div className="flex flex-col items-center mr-4" style={{ width: 28 }}>
                  {/* Node */}
                  <div
                    className="relative flex items-center justify-center rounded-full flex-shrink-0"
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
                  {/* Connector line */}
                  {i < displayPath.length - 1 && (
                    <div
                      className="flex-1"
                      style={{
                        width: 0,
                        minHeight: expanded ? 8 : 24,
                        borderLeft: connectorDashed
                          ? '2px dashed #d1d5db'
                          : `2px solid ${i < currentIndex ? '#22c55e' : '#d1d5db'}`,
                      }}
                    />
                  )}
                </div>

                {/* Right column: label + details */}
                <div className={`flex-1 ${i < displayPath.length - 1 ? 'pb-2' : ''}`}>
                  <div
                    className={`flex items-center gap-2 py-1 rounded -mt-0.5 ${hasDetails ? 'cursor-pointer hover:bg-accent/50' : ''}`}
                    style={{ minHeight: isSkipped ? 22 : 28 }}
                    onClick={() => hasDetails && toggleStep(i)}
                  >
                    <span
                      className="text-sm font-medium"
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
                    {hasDetails && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        {expanded ? '\u25BC' : '\u25B6'}
                      </span>
                    )}
                  </div>

                  {/* Expanded details */}
                  {expanded && hasDetails && (
                    <div className="ml-1 mt-1 mb-2 pl-3 border-l-2 text-xs space-y-1.5" style={{ borderColor: isCompleted || isFinalCurrent ? '#22c55e' : '#3b82f6' }}>
                      {(isCompleted || isFinalCurrent) && details && (
                        <>
                          <div className="flex gap-2">
                            <span className="text-muted-foreground">Arrived at:</span>
                            <span className="font-mono">{formatTime(details.timestamp)}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-muted-foreground">Duration:</span>
                            <span>{details.duration != null ? formatDuration(details.duration) : 'N/A'}</span>
                          </div>
                          {details.trigger && (
                            <div className="flex gap-2 items-center">
                              <span className="text-muted-foreground">Trigger:</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{details.trigger}</Badge>
                            </div>
                          )}
                          {details.guardResults && typeof details.guardResults === 'object' && Object.keys(details.guardResults as object).length > 0 && (
                            <div>
                              <span className="text-muted-foreground">Guard results:</span>
                              <pre className="text-[11px] bg-muted p-2 rounded mt-1 overflow-x-auto max-h-[200px] overflow-y-auto">
                                {JSON.stringify(details.guardResults, null, 2)}
                              </pre>
                            </div>
                          )}
                        </>
                      )}
                      {isCurrent && !isFinalCurrent && details && (
                        <>
                          <div className="flex gap-2">
                            <span className="text-muted-foreground">Active since:</span>
                            <span className="font-mono">{formatTime(details.timestamp)}</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-muted-foreground">Duration so far:</span>
                            <span>{currentDuration != null ? formatDuration(currentDuration) : 'N/A'}</span>
                          </div>
                          {details.trigger && (
                            <div className="flex gap-2 items-center">
                              <span className="text-muted-foreground">Trigger:</span>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">{details.trigger}</Badge>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
