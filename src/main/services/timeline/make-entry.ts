import type { DebugTimelineEntry } from '../../../shared/types';

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return (hash >>> 0).toString(36);
}

export function makeEntry(
  timestamp: number,
  source: DebugTimelineEntry['source'],
  severity: DebugTimelineEntry['severity'],
  title: string,
  data?: Record<string, unknown>,
): DebugTimelineEntry {
  return {
    id: djb2(`${timestamp}-${source}-${title}`),
    timestamp,
    source,
    severity,
    title,
    ...(data !== undefined ? { data } : {}),
  };
}
