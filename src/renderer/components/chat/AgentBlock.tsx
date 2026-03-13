import React, { useState, useEffect, useMemo } from 'react';
import { Bot, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, Clock, Cpu, FileText, Zap } from 'lucide-react';
import type { AgentSegment } from './ChatMessageList';
import type { AgentChatMessage, AgentChatMessageUsage } from '../../../shared/types';
import { ThinkingGroup } from './ThinkingGroup';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { renderToolContent } from '../tool-renderers/renderUtils';

interface AgentBlockProps {
  segment: AgentSegment;
  expandedTools: Set<number>;
  onToggleTool: (index: number) => void;
  /** Whether the parent chat session is still running. */
  sessionRunning?: boolean;
}

/** Parse the Task tool_use input JSON to extract agent metadata. */
function parseAgentInput(input: string): {
  subagentType: string;
  description: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
  runInBackground?: boolean;
  resume?: string;
} {
  try {
    const parsed = JSON.parse(input);
    return {
      subagentType: parsed.subagent_type || 'agent',
      description: parsed.description || '',
      prompt: parsed.prompt || '',
      model: parsed.model,
      maxTurns: parsed.max_turns,
      runInBackground: parsed.run_in_background,
      resume: parsed.resume,
    };
  } catch {
    return { subagentType: 'agent', description: input.slice(0, 60), prompt: '' };
  }
}

/** Format duration in seconds to human-readable string. */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

/** Determine the agent's status from the segment data. */
function getAgentStatus(segment: AgentSegment, sessionRunning?: boolean): 'initializing' | 'running' | 'completed' | 'stopped' | 'error' {
  if (segment.completedActivity) return 'completed';
  // Check if tool_result indicates an error
  if (segment.taskToolResult) {
    const result = segment.taskToolResult.result;
    if (result && (result.includes('Error') || result.includes('error') || result.includes('failed'))) {
      return 'error';
    }
    return 'completed';
  }
  // If session is no longer running but agent has no completion, it was stopped
  if (!sessionRunning && segment.startedActivity) return 'stopped';
  if (!sessionRunning) return 'stopped';
  if (segment.startedActivity) return 'running';
  return 'initializing';
}

/** Capitalize first letter. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Parse the agent result to extract clean output, stripping metadata like agentId and <usage> tags. */
function parseAgentResult(raw: string): { cleanResult: string; agentId?: string; totalTokens?: number; toolUses?: number; durationMs?: number } {
  let cleanResult = raw;
  let agentId: string | undefined;
  let totalTokens: number | undefined;
  let toolUses: number | undefined;
  let durationMs: number | undefined;

  // Extract agentId line: "agentId: abc123 (for resuming...)"
  const agentIdMatch = cleanResult.match(/agentId:\s*(\S+)\s*\(for resuming[^)]*\)\n?/);
  if (agentIdMatch) {
    agentId = agentIdMatch[1];
    cleanResult = cleanResult.replace(agentIdMatch[0], '');
  }

  // Extract <usage> block
  const usageMatch = cleanResult.match(/<usage>\s*([\s\S]*?)\s*<\/usage>\n?/);
  if (usageMatch) {
    const usageContent = usageMatch[1];
    const tokensMatch = usageContent.match(/total_tokens:\s*(\d+)/);
    const toolUsesMatch = usageContent.match(/tool_uses:\s*(\d+)/);
    const durationMatch = usageContent.match(/duration_ms:\s*(\d+)/);
    if (tokensMatch) totalTokens = parseInt(tokensMatch[1], 10);
    if (toolUsesMatch) toolUses = parseInt(toolUsesMatch[1], 10);
    if (durationMatch) durationMs = parseInt(durationMatch[1], 10);
    cleanResult = cleanResult.replace(usageMatch[0], '');
  }

  return { cleanResult: cleanResult.trim(), agentId, totalTokens, toolUses, durationMs };
}

/** Count tool_use messages in internal messages. */
function countToolCalls(internalMessages: AgentChatMessage[]): number {
  return internalMessages.filter(m => m.type === 'tool_use').length;
}

export function AgentBlock({ segment, expandedTools, onToggleTool, sessionRunning }: AgentBlockProps) {
  const agentInput = useMemo(() => parseAgentInput(segment.taskToolUse.input), [segment.taskToolUse.input]);
  const status = getAgentStatus(segment, sessionRunning);
  const isRunning = status === 'running' || status === 'initializing';

  // ── Collapsible section state ──
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [resultExpanded, setResultExpanded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<{ title: string; text: string }>({ title: '', text: '' });

  // ── Live elapsed timer ──
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const startTs = segment.startedActivity?.timestamp ?? segment.taskToolUse.timestamp;
    const endTs = segment.completedActivity?.timestamp;

    if (endTs) {
      setElapsed(formatDuration(endTs - startTs));
      return;
    }

    // Live-updating timer for running agents
    setElapsed(formatDuration(Date.now() - startTs));
    const interval = setInterval(() => {
      setElapsed(formatDuration(Date.now() - startTs));
    }, 1000);
    return () => clearInterval(interval);
  }, [segment.startedActivity?.timestamp, segment.completedActivity?.timestamp, segment.taskToolUse.timestamp]);

  // ── Aggregate token usage from internal messages ──
  const { totalInputTokens, totalOutputTokens } = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const msg of segment.internalMessages) {
      if (msg.type === 'usage') {
        const usage = msg as AgentChatMessageUsage;
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
      }
    }
    return { totalInputTokens: inputTokens, totalOutputTokens: outputTokens };
  }, [segment.internalMessages]);

  const totalTokens = totalInputTokens + totalOutputTokens;
  const hasInternalMessages = segment.internalMessages.length > 0;
  const hasResult = !!segment.taskToolResult;
  const toolCallCount = useMemo(() => countToolCalls(segment.internalMessages), [segment.internalMessages]);
  const parsedResult = useMemo(() => segment.taskToolResult ? parseAgentResult(segment.taskToolResult.result) : null, [segment.taskToolResult]);
  // Use parsed result tokens/tool_uses if internal messages don't have usage data
  const displayTokens = totalTokens > 0 ? totalTokens : (parsedResult?.totalTokens ?? 0);
  const displayToolUses = toolCallCount > 0 ? toolCallCount : (parsedResult?.toolUses ?? 0);

  // ── Status styling ──
  const statusConfig = {
    initializing: { label: 'Initializing...', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.06)', icon: <Clock className="h-3.5 w-3.5" style={{ color: '#8b5cf6' }} />, borderColor: '#8b5cf6', bgTint: 'rgba(139, 92, 246, 0.03)' },
    running: { label: 'Running', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.06)', icon: <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />, borderColor: '#6366f1', bgTint: 'rgba(59, 130, 246, 0.03)' },
    completed: { label: 'Completed', color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.06)', icon: <CheckCircle2 className="h-3.5 w-3.5" style={{ color: '#22c55e' }} />, borderColor: '#22c55e', bgTint: 'rgba(34, 197, 94, 0.02)' },
    stopped: { label: 'Stopped', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.06)', icon: <AlertCircle className="h-3.5 w-3.5" style={{ color: '#f59e0b' }} />, borderColor: '#f59e0b', bgTint: 'rgba(245, 158, 11, 0.02)' },
    error: { label: 'Error', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.06)', icon: <AlertCircle className="h-3.5 w-3.5" style={{ color: '#ef4444' }} />, borderColor: '#ef4444', bgTint: 'rgba(239, 68, 68, 0.02)' },
  }[status];

  // ── Extract last tool call name for running indicator ──
  const lastToolName = useMemo(() => {
    for (let i = segment.internalMessages.length - 1; i >= 0; i--) {
      const msg = segment.internalMessages[i] as unknown as Record<string, unknown>;
      if (msg.type === 'tool_use' && typeof msg.name === 'string') {
        return msg.name;
      }
    }
    return null;
  }, [segment.internalMessages]);

  const openDialog = (title: string, text: string) => {
    setDialogContent({ title, text });
    setDialogOpen(true);
  };

  return (
    <div
      className={`my-2 rounded-lg border-l-[3px] border border-border overflow-hidden${
        status === 'running' ? ' agent-running-border agent-shimmer' : ''
      }`}
      style={{
        borderLeftColor: statusConfig.borderColor,
        backgroundColor: statusConfig.bgTint,
        transition: 'border-color 0.5s ease, background-color 0.5s ease, box-shadow 0.5s ease',
      }}
    >
      {/* ── Header: [Icon] [Title] [Type] [Model] ... [Duration] ── */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 flex-shrink-0" style={{ color: statusConfig.borderColor, transition: 'color 0.5s ease' }} />
          <span className="text-sm text-foreground font-medium truncate flex-1">
            {agentInput.description}
          </span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/15 text-indigo-500 flex-shrink-0">
            {capitalize(agentInput.subagentType)}
          </span>
          {agentInput.model && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground flex-shrink-0">
              <Cpu className="h-3 w-3" />
              {agentInput.model}
            </span>
          )}
          {elapsed && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
              <Clock className="h-3 w-3" />
              {elapsed}
            </span>
          )}
          {agentInput.resume && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-medium flex-shrink-0">
              Resumed
            </span>
          )}
        </div>
        {/* Status indicator under title */}
        <div className="flex items-center gap-1.5 mt-1.5 ml-6">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
            style={{ color: statusConfig.color, backgroundColor: statusConfig.bgColor }}
          >
            {statusConfig.icon}
            {statusConfig.label}
          </span>
        </div>
      </div>

      {/* ── Metadata row ── */}
      <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] text-muted-foreground border-t border-border/40">
        {totalTokens > 0 && (
          <span className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            {totalTokens.toLocaleString()} tokens
          </span>
        )}
        {agentInput.maxTurns != null && (
          <span>max {agentInput.maxTurns} turns</span>
        )}
        {agentInput.runInBackground && (
          <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px] font-medium">background</span>
        )}
      </div>

      {/* ── Prompt section (at the top, below header) ── */}
      {agentInput.prompt && (
        <div className="border-t border-border/40">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground/80 hover:bg-muted/30 transition-colors"
            onClick={() => setPromptExpanded(v => !v)}
          >
            {promptExpanded
              ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            }
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            <span>Prompt</span>
          </button>
          {promptExpanded && (
            <div className="px-3 pb-2">
              <div className="bg-muted/30 rounded border border-border p-2 overflow-x-auto max-h-48 overflow-y-auto">
                <pre className="text-xs font-mono whitespace-pre-wrap">
                  {agentInput.prompt.length > 3000 ? agentInput.prompt.slice(0, 3000) + '\n... (truncated)' : agentInput.prompt}
                </pre>
              </div>
              {agentInput.prompt.length > 3000 && (
                <button
                  className="text-xs text-primary hover:underline mt-1"
                  onClick={() => openDialog('Agent Prompt', agentInput.prompt)}
                >
                  View Full
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Internal calls section (collapsible) ── */}
      {hasInternalMessages && (
        <div className="border-t border-border/40">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground/80 hover:bg-muted/30 transition-colors"
            onClick={() => setInternalExpanded(v => !v)}
          >
            {internalExpanded
              ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            }
            <span>Internal calls</span>
            <span className="text-muted-foreground/60 text-[10px] ml-1">
              {[
                displayToolUses > 0 ? `${displayToolUses} tool call${displayToolUses !== 1 ? 's' : ''}` : null,
                displayTokens > 0 ? `${displayTokens.toLocaleString()} tokens` : null,
              ].filter(Boolean).join(' · ')}
            </span>
          </button>
          {internalExpanded && (
            <div className="px-3 pb-2">
              <ThinkingGroup
                messages={segment.internalMessages}
                startIndex={segment.startIndex + 1}
                expandedTools={expandedTools}
                onToggleTool={onToggleTool}
                defaultExpanded
              />
            </div>
          )}
        </div>
      )}

      {/* ── Result section (collapsible) ── */}
      {hasResult && parsedResult && (
        <div className="border-t border-border/40">
          <button
            type="button"
            className="flex items-center gap-1.5 w-full text-left px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground/80 hover:bg-muted/30 transition-colors"
            onClick={() => setResultExpanded(v => !v)}
          >
            {resultExpanded
              ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
              : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
            }
            <span>Result</span>
          </button>
          {resultExpanded && (
            <div className="px-3 pb-2">
              <div className="bg-muted/30 rounded border border-border p-2 overflow-x-auto max-h-48 overflow-y-auto">
                {renderToolContent(parsedResult.cleanResult, 3000)}
              </div>
              {parsedResult.cleanResult.length > 3000 && (
                <button
                  className="text-xs text-primary hover:underline mt-1"
                  onClick={() => openDialog('Agent Result', parsedResult.cleanResult)}
                >
                  View Full
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Running indicator (when no result yet) ── */}
      {isRunning && !hasResult && (
        <div className="border-t border-border/40 px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: statusConfig.borderColor }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: statusConfig.borderColor, animationDelay: '0.2s' }} />
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: statusConfig.borderColor, animationDelay: '0.4s' }} />
          </div>
          <span>{lastToolName ? `Using ${lastToolName}...` : 'Agent is working...'}</span>
        </div>
      )}

      {/* ── Full-content dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl" style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
          <DialogHeader>
            <DialogTitle className="text-sm">{dialogContent.title}</DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-muted p-3 rounded overflow-auto whitespace-pre-wrap" style={{ flex: 1, minHeight: 0 }}>
            {dialogContent.text}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
