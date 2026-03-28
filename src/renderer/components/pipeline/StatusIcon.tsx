import React, { useMemo } from 'react';
import type { Pipeline } from '../../../shared/types';

/** Default fallback color when no pipeline color is defined for a status. */
const FALLBACK_COLOR = '#6b7280';

/**
 * Build a flat status-name → hex-color lookup from an array of pipelines.
 * If the same status name appears in multiple pipelines the first one wins.
 */
export function buildStatusColorMap(pipelines: Pipeline[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of pipelines) {
    for (const s of p.statuses) {
      if (!map[s.name] && s.color) {
        map[s.name] = s.color;
      }
    }
  }
  return map;
}

/**
 * React hook version — memoises the color map so it stays stable across renders.
 */
export function useStatusColorMap(pipelines: Pipeline[]): Record<string, string> {
  return useMemo(() => buildStatusColorMap(pipelines), [pipelines]);
}

interface StatusIconProps {
  /** Pipeline status name (e.g. "open", "implementing", "done"). */
  status: string;
  /** Status-name → hex-color map (from `useStatusColorMap`). */
  colorMap: Record<string, string>;
}

/**
 * Renders a small colored circle SVG icon for a pipeline status.
 *
 * Special shapes:
 * - `done`  → filled circle with a checkmark
 * - `open`  → filled circle with an inner white dot
 * - all others → solid filled circle
 *
 * The fill color is resolved from the pipeline-defined color map, falling
 * back to gray (`#6b7280`) when the status is unknown.
 */
export function StatusIcon({ status, colorMap }: StatusIconProps) {
  const color = colorMap[status] ?? FALLBACK_COLOR;

  if (status === 'done') {
    return (
      <svg className="shrink-0 w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="8" fill={color} />
        <path
          d="M4.5 8.5L7 11L11.5 5.5"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (status === 'open') {
    return (
      <svg className="shrink-0 w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="8" fill={color} />
        <circle cx="8" cy="8" r="3" fill="white" />
      </svg>
    );
  }

  // Default: solid filled circle
  return (
    <svg className="shrink-0 w-3.5 h-3.5" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill={color} />
    </svg>
  );
}
