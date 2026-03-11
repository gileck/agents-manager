import React, { useState } from 'react';
import { Button } from '../ui/button';
import { ChevronDown, ChevronRight, Copy, Check } from 'lucide-react';
import { reportError } from '../../lib/error-handler';

interface AgentRunErrorBannerProps {
  error: string;
  /** Compact mode for inline display (e.g., StatusActionBar) — hides details, shows only summary */
  compact?: boolean;
}

/** Format seconds into a human-readable duration string */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/** Translate raw technical error strings into user-friendly summaries */
function humanizeErrorSummary(raw: string): string {
  // Pattern: "Agent aborted after Xs (N messages processed) [kill_reason=...]"
  const abortMatch = raw.match(/^Agent aborted after (\d+)s \(\d+ messages processed\) \[kill_reason=(\w+)\]$/);
  if (abortMatch) {
    const duration = formatDuration(Number(abortMatch[1]));
    const reason = abortMatch[2];
    if (reason === 'stopped') return `Agent was stopped by user after ${duration}`;
    if (reason === 'timeout') return `Agent timed out after ${duration}`;
    return `Agent was interrupted after ${duration}`;
  }

  // Pattern: "Agent timed out after Xs (timeout=Xs, N messages processed)"
  const timeoutMatch = raw.match(/^Agent timed out after (\d+)s \(timeout=\d+s, \d+ messages processed\)$/);
  if (timeoutMatch) {
    const duration = formatDuration(Number(timeoutMatch[1]));
    return `Agent timed out after ${duration}`;
  }

  return raw;
}

/** Parse error string into summary line and structured diagnostics */
function parseError(error: string): { summary: string; diagnostics: Record<string, string> | null; rawDiagnostics: string | null } {
  const diagSeparator = '--- Diagnostics ---';
  const sepIdx = error.indexOf(diagSeparator);
  if (sepIdx === -1) {
    return { summary: error.trim(), diagnostics: null, rawDiagnostics: null };
  }

  const summary = error.slice(0, sepIdx).trim();
  const rawDiagnostics = error.slice(sepIdx + diagSeparator.length).trim();

  // Parse key: value pairs from diagnostics
  const diagnostics: Record<string, string> = {};
  for (const line of rawDiagnostics.split('\n')) {
    const colonIdx = line.indexOf(': ');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 2).trim();
      if (key && value) diagnostics[key] = value;
    }
  }

  return { summary, diagnostics: Object.keys(diagnostics).length > 0 ? diagnostics : null, rawDiagnostics };
}

export function AgentRunErrorBanner({ error, compact }: AgentRunErrorBannerProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const { summary, diagnostics, rawDiagnostics } = parseError(error);
  const hasDiagnostics = diagnostics || rawDiagnostics;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(error).catch((err) => reportError(err, 'Copy error to clipboard'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (compact) {
    return (
      <span className="text-sm font-medium" style={{ color: '#dc2626' }}>
        {humanizeErrorSummary(summary)}
      </span>
    );
  }

  return (
    <div className="mx-6 mt-2 rounded-md overflow-hidden" style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5' }}>
      {/* Summary row */}
      <div className="px-4 py-3 flex items-start gap-3">
        <svg className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: '#dc2626' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium" style={{ color: '#dc2626' }}>{humanizeErrorSummary(summary)}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 text-xs"
            style={{ borderColor: '#fca5a5', color: '#dc2626' }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="ml-1">{copied ? 'Copied' : 'Copy Full Error'}</span>
          </Button>
          {hasDiagnostics && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs font-medium hover:opacity-80 transition-opacity"
              style={{ color: '#dc2626' }}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Details
            </button>
          )}
        </div>
      </div>

      {/* Expanded diagnostics */}
      {expanded && hasDiagnostics && (
        <div className="px-4 pb-3 pt-0">
          <div className="rounded-md p-3" style={{ backgroundColor: '#fee2e2', border: '1px solid #fca5a5' }}>
            {diagnostics ? (
              <div className="space-y-1">
                {Object.entries(diagnostics).map(([key, value]) => (
                  <div key={key} className="flex gap-2 text-xs font-mono">
                    <span className="flex-shrink-0 font-semibold" style={{ color: '#991b1b' }}>{key}:</span>
                    <span style={{ color: '#dc2626', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap" style={{ color: '#dc2626' }}>
                {rawDiagnostics}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
