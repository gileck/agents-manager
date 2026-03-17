/**
 * Shared constants, helpers, and inline style objects for terminal tool renderers.
 */

export const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** Truncate text to maxLen, appending ellipsis if needed. */
export function truncateInline(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\u2026';
}

/** Count newlines in text (returns number of lines). */
export function countLines(text: string): number {
  if (!text) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') count++;
  }
  return count;
}

/** Safely parse JSON input from tool_use. */
export function safeParseInput(input: string): Record<string, unknown> {
  try { return JSON.parse(input); }
  catch { return {}; }
}

/** Extract short file path (last 3 segments). */
export function shortPath(path: string): string {
  return path.split('/').slice(-3).join('/');
}

/** Green bullet style for the `●` prefix. */
export const bulletStyle: React.CSSProperties = {
  color: '#22c55e',
  fontSize: 14,
  flexShrink: 0,
  userSelect: 'none',
};

/** Muted `└` connector style. */
export const connectorStyle: React.CSSProperties = {
  color: '#4b5563',
  fontSize: 12,
  marginRight: 4,
  userSelect: 'none',
};

/** Header row container style. */
export const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 0',
  cursor: 'pointer',
  lineHeight: '20px',
};

/** Result row container style. */
export const resultRowStyle: React.CSSProperties = {
  paddingLeft: 20,
  fontSize: 12,
  lineHeight: '18px',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 0,
};

/** Expanded content container style. */
export const expandedContentStyle: React.CSSProperties = {
  marginLeft: 20,
  marginTop: 2,
  padding: '4px 8px',
  backgroundColor: '#111827',
  borderRadius: 4,
  maxHeight: 300,
  overflowY: 'auto',
  borderLeft: '1px solid #1e293b',
};

/** Pre-formatted content style. */
export const preStyle: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: 11,
  fontFamily: MONO,
  whiteSpace: 'pre-wrap',
  margin: 0,
  wordBreak: 'break-word',
};

/** Tool name style (bold). */
export const toolNameStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#d1d5db',
};

/** Muted argument/summary style. */
export const argStyle: React.CSSProperties = {
  color: '#9ca3af',
};

/** Running indicator style. */
export const runningStyle: React.CSSProperties = {
  color: '#6b7280',
  fontSize: 11,
  fontStyle: 'italic',
};
