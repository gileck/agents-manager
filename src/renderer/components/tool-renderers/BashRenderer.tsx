import React, { useState } from 'react';
import type { ToolRendererProps } from './types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { TaskActionCard } from './TaskActionCard';
import type { Task } from '../../../shared/types';
import { renderToolContent } from './renderUtils';

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

const TASK_CLI_PATTERN = /npx\s+agents-manager\s+tasks?\s+(create|get|update|transition)\b/;

function isTaskCliCommand(command: string): boolean {
  return TASK_CLI_PATTERN.test(command);
}

function parseTaskResult(result: string): Task | null {
  try {
    const parsed = JSON.parse(result);
    if (!parsed || typeof parsed !== 'object') return null;
    // Transition shape: { success, task?, error?, guardFailures? }
    if ('success' in parsed) {
      if (parsed.success && parsed.task && typeof parsed.task.id === 'string') {
        return parsed.task as Task;
      }
      return null;
    }
    // Direct Task shape
    if (typeof parsed.id === 'string' && typeof parsed.title === 'string') {
      return parsed as Task;
    }
    return null;
  } catch {
    return null;
  }
}


export function BashRenderer({ toolUse, toolResult, expanded, onToggle }: ToolRendererProps) {
  const { command, description } = parseSummary(toolUse.input);
  const shortCmd = command.length > 60 ? command.slice(0, 60) + '...' : command;
  const duration = toolResult ? toolResult.timestamp - toolUse.timestamp : null;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const taskCliDetected = isTaskCliCommand(command);
  const parsedTask = taskCliDetected && toolResult ? parseTaskResult(toolResult.result) : null;

  return (
    <div className="border border-border rounded my-1 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors text-left"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          {description ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-foreground font-medium truncate">{description}</span>
              <div className="flex items-center gap-1.5 text-muted-foreground font-mono">
                <span className="text-green-500">$</span>
                <span className="truncate">{shortCmd}</span>
                {duration != null && (
                  <span className="flex-shrink-0">· {formatDuration(duration)}</span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 font-mono">
              <span className="text-green-500">$</span>
              <span className="text-foreground truncate">{shortCmd}</span>
              {duration != null && (
                <span className="text-muted-foreground flex-shrink-0 ml-1">{formatDuration(duration)}</span>
              )}
            </div>
          )}
        </div>
        <svg className={`w-3 h-3 text-muted-foreground transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && toolResult && parsedTask && (
        <div className="border-t border-border p-2">
          <TaskActionCard task={parsedTask} rawOutput={toolResult.result} />
        </div>
      )}
      {expanded && !parsedTask && (
        <div className="border-t border-border">
          <div className="bg-muted/60 border-b border-border px-3 py-2 flex items-start gap-2">
            <span className="text-green-500 font-mono text-xs flex-shrink-0 mt-0.5">$</span>
            <pre className="text-xs font-mono text-foreground overflow-x-auto whitespace-pre flex-1">{command}</pre>
            <button
              className="text-xs text-muted-foreground hover:text-foreground flex-shrink-0 transition-colors px-1"
              onClick={handleCopy}
              title="Copy command"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {description && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
              {description}
            </div>
          )}
          {toolResult && (
            <>
              <div className="text-xs bg-muted p-3 overflow-x-auto" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {renderToolContent(toolResult.result)}
              </div>
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
            </>
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
