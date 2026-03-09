import React from 'react';

/**
 * Renders tool content (input or result) with JSON auto-detection.
 *
 * Parses the full raw string first, then truncates the pretty-printed output
 * if maxLen is provided — this ensures JSON detection works even for large
 * payloads, unlike truncating before parsing.
 */
export function renderToolContent(raw: string, maxLen?: number): React.ReactNode {
  let text = raw;
  let isJson = false;

  try {
    const parsed = JSON.parse(raw);
    text = JSON.stringify(parsed, null, 2);
    isJson = true;
  } catch { /* not JSON — use raw as-is */ }

  const display = maxLen && text.length > maxLen
    ? text.slice(0, maxLen) + '\n... (truncated)'
    : text;

  if (isJson) {
    return (
      <div>
        <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-mono mb-1">JSON</span>
        <pre className="text-xs font-mono overflow-x-auto whitespace-pre">{display}</pre>
      </div>
    );
  }
  return <pre className="text-xs font-mono whitespace-pre-wrap">{display}</pre>;
}
