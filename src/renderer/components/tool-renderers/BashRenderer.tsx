import React, { useState } from 'react';
import type { ToolRendererProps } from './types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

function parseSummary(input: string): { command: string; description?: string } {
  try {
    const parsed = JSON.parse(input);
    return {
      command: parsed.command || '...',
      description: parsed.description,
    };
  } catch { /* fallback */ }
  return { command: input.slice(0, 80) };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function BashRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const { command, description } = parseSummary(toolUse.input);
  const shortCmd = command.length > 60 ? command.slice(0, 60) + '...' : command;
  const duration = toolResult ? toolResult.timestamp - toolUse.timestamp : null;
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left font-mono"
        onClick={onToggle}
      >
        <span className="text-green-500">$</span>
        <span className="text-foreground truncate">{shortCmd}</span>
        {description && <span className="text-muted-foreground truncate ml-1">({description})</span>}
        {duration != null && (
          <span className="text-muted-foreground ml-1 flex-shrink-0">{formatDuration(duration)}</span>
        )}
        <svg className={`w-3 h-3 ml-auto text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && toolResult && (
        <div className="border-t border-border">
          <pre className="text-xs bg-muted p-2 overflow-x-auto whitespace-pre-wrap" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {toolResult.result}
          </pre>
          {toolResult.result.length > 500 && (
            <div className="px-2 py-1 border-t border-border">
              <button
                className="text-xs text-primary hover:underline"
                onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }}
              >
                View Full Output
              </button>
            </div>
          )}
        </div>
      )}
      {!expanded && !toolResult && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Running...
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl" style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
          <DialogHeader>
            <DialogTitle className="font-mono text-sm">
              <span className="text-green-500">$ </span>{command}
            </DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-muted p-3 rounded overflow-auto whitespace-pre-wrap" style={{ flex: 1, minHeight: 0 }}>
            {toolResult?.result}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
