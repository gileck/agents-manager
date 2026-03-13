import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { AgentChatMessage, AgentChatMessageToolUse, AgentChatMessageToolResult, AgentChatMessagePostProcessingLog, PostProcessingLogCategory } from '../../../shared/types';
import { MarkdownContent } from '../chat/MarkdownContent';
import { ThinkingBlock } from '../chat/ThinkingBlock';
import { getToolRenderer } from '../tool-renderers';
import { TodoPanel, type TodoItem } from './TodoPanel';
import { cn } from '../../lib/utils';

interface RenderedOutputPanelProps {
  messages: AgentChatMessage[];
  isRunning: boolean;
  startedAt?: number;
  showTimestamps?: boolean;
  showPostProcessingLogs?: boolean;
  activePostLogCategories?: Set<PostProcessingLogCategory>;
}

/** Colors for each post-processing log category badge. */
const CATEGORY_COLORS: Record<PostProcessingLogCategory, string> = {
  validation: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  git: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30',
  pipeline: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30',
  extraction: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
  notification: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30',
  system: 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30',
};

/** Human-readable labels for post-processing categories. */
export const CATEGORY_LABELS: Record<PostProcessingLogCategory, string> = {
  validation: 'Validation',
  git: 'Git',
  pipeline: 'Pipeline',
  extraction: 'Extraction',
  notification: 'Notification',
  system: 'System',
};

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `+${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function extractLatestTodos(messages: AgentChatMessage[]): TodoItem[] {
  let latestTodos: TodoItem[] = [];
  for (const msg of messages) {
    if (msg.type === 'tool_use' && msg.toolName === 'TodoWrite') {
      try {
        const parsed = JSON.parse(msg.input);
        if (parsed.todos && Array.isArray(parsed.todos)) {
          latestTodos = parsed.todos;
        }
      } catch { /* ignore */ }
    }
  }
  return latestTodos;
}

export function RenderedOutputPanel({ messages, isRunning, startedAt, showTimestamps = false, showPostProcessingLogs = false, activePostLogCategories }: RenderedOutputPanelProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const toggleTool = useCallback((index: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  const todos = useMemo(() => extractLatestTodos(messages), [messages]);

  // Render messages (memoized to avoid re-running JSON parsing on scroll)
  const rendered = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    const ts = (timestamp: number) => {
      if (!showTimestamps || !startedAt || !timestamp) return null;
      return (
        <span className="text-xs text-muted-foreground font-mono mr-2 flex-shrink-0" style={{ minWidth: '44px' }}>
          {formatElapsed(timestamp - startedAt)}
        </span>
      );
    };
    // Pre-build toolId → toolResult map so parallel tool calls get matched
    const resultMap = new Map<string, AgentChatMessageToolResult>();
    for (const msg of messages) {
      if (msg.type === 'tool_result' && msg.toolId) {
        resultMap.set(msg.toolId, msg as AgentChatMessageToolResult);
      }
    }
    const matchedResultIds = new Set<string>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.type === 'assistant_text') {
        nodes.push(
          <div key={i} className="py-1 flex">
            {ts(msg.timestamp)}
            <div className="flex-1 min-w-0">
              <MarkdownContent content={msg.text} />
            </div>
          </div>
        );
      } else if (msg.type === 'tool_use') {
        const toolUse = msg as AgentChatMessageToolUse;
        const toolResult = toolUse.toolId ? resultMap.get(toolUse.toolId) : undefined;
        if (toolResult?.toolId) matchedResultIds.add(toolResult.toolId);
        const Renderer = getToolRenderer(toolUse.toolName);
        nodes.push(
          <div key={i} className="flex">
            {ts(toolUse.timestamp)}
            <div className="flex-1 min-w-0">
              <Renderer
                toolUse={toolUse}
                toolResult={toolResult}
                expanded={expandedTools.has(i)}
                onToggle={() => toggleTool(i)}
              />
            </div>
          </div>
        );
      } else if (msg.type === 'tool_result') {
        const result = msg as AgentChatMessageToolResult;
        if (result.toolId && matchedResultIds.has(result.toolId)) continue; // already paired
        nodes.push(
          <div key={i} className="flex">
            {ts(msg.timestamp)}
            <div className="flex-1 min-w-0 border border-border rounded p-2 my-1 text-xs">
              <span className="text-muted-foreground">Tool result:</span>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto text-xs">
                {result.result.length > 1000 ? result.result.slice(0, 1000) + '\n...' : result.result}
              </pre>
            </div>
          </div>
        );
      } else if (msg.type === 'user') {
        nodes.push(
          <div key={i} className="flex justify-end py-1">
            {ts(msg.timestamp)}
            <div className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 max-w-[80%]">
              <p className="text-sm">{msg.text}</p>
            </div>
          </div>
        );
      } else if (msg.type === 'thinking') {
        nodes.push(
          <ThinkingBlock key={i} text={msg.text} timestamp={msg.timestamp} ts={ts} />
        );
      } else if (msg.type === 'status') {
        nodes.push(
          <div key={i} className="flex items-center py-1">
            {ts(msg.timestamp)}
            <div className="flex-1 text-center">
              <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                {msg.message}
              </span>
            </div>
          </div>
        );
      }
      // usage messages are skipped (shown in sidebar)
    }
    return nodes;
  }, [messages, expandedTools, toggleTool, showTimestamps, startedAt]);

  // Separate post-processing log messages and filter by active categories
  const postProcessingNodes = useMemo(() => {
    if (!showPostProcessingLogs) return [];
    const nodes: React.ReactNode[] = [];
    let hasSeparator = false;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.type !== 'post_processing_log') continue;
      const logMsg = msg as AgentChatMessagePostProcessingLog;

      // Filter by active categories if provided (empty set = show all)
      if (activePostLogCategories && activePostLogCategories.size > 0 && !activePostLogCategories.has(logMsg.category)) {
        continue;
      }

      // Add separator before the first post-processing message
      if (!hasSeparator) {
        hasSeparator = true;
        nodes.push(
          <div key="post-processing-separator" className="flex items-center gap-3 py-2 my-1">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs font-medium text-muted-foreground">Post-processing</span>
            <div className="flex-1 h-px bg-border" />
          </div>
        );
      }

      // Check if this is a timing summary message
      const isTimingSummary = logMsg.details?.timingSummary != null;

      if (isTimingSummary) {
        const summary = logMsg.details!.timingSummary as Record<string, number>;
        const totalMs = logMsg.durationMs ?? 0;
        nodes.push(
          <div key={`post-log-${i}`} className="py-1.5 px-2 my-1 rounded-md border border-border bg-muted/40">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold', CATEGORY_COLORS.system)}>
                {CATEGORY_LABELS.system}
              </span>
              <span className="text-xs font-medium text-foreground">{logMsg.message}</span>
              {totalMs > 0 && (
                <span className="text-[10px] font-mono text-muted-foreground ml-auto">{formatDurationMs(totalMs)}</span>
              )}
            </div>
            <div className="ml-2 space-y-0.5">
              {Object.entries(summary).map(([cat, ms]) => (
                <div key={cat} className="flex items-center gap-2 text-xs">
                  <span className={cn('inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium', CATEGORY_COLORS[cat as PostProcessingLogCategory] ?? CATEGORY_COLORS.system)}>
                    {CATEGORY_LABELS[cat as PostProcessingLogCategory] ?? cat}
                  </span>
                  <span className="font-mono text-muted-foreground">{formatDurationMs(ms as number)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      } else {
        nodes.push(
          <div key={`post-log-${i}`} className="flex items-start gap-2 py-0.5 text-xs">
            <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold flex-shrink-0 mt-0.5', CATEGORY_COLORS[logMsg.category])}>
              {CATEGORY_LABELS[logMsg.category]}
            </span>
            <span className="text-muted-foreground flex-1 min-w-0">{logMsg.message}</span>
            {logMsg.durationMs != null && (
              <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">{formatDurationMs(logMsg.durationMs)}</span>
            )}
          </div>
        );
      }
    }

    return nodes;
  }, [messages, showPostProcessingLogs, activePostLogCategories]);

  return (
    <div className="flex flex-1 min-h-0 min-w-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2"
      >
        {rendered.length === 0 && isRunning && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Waiting for agent output...
          </div>
        )}
        {rendered}
        {postProcessingNodes}
        {isRunning && rendered.length > 0 && (
          <div className="flex items-center gap-2 py-2 text-muted-foreground text-sm">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
            Agent is thinking...
          </div>
        )}
        <div ref={endRef} />
      </div>
      {todos.length > 0 && <TodoPanel todos={todos} />}
    </div>
  );
}
