import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { AgentChatMessage, AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../shared/types';
import { MarkdownContent } from '../chat/MarkdownContent';
import { getToolRenderer } from './tool-renderers';
import { TodoPanel, type TodoItem } from './TodoPanel';

interface RenderedOutputPanelProps {
  messages: AgentChatMessage[];
  isRunning: boolean;
  startedAt?: number;
  showTimestamps?: boolean;
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

export function RenderedOutputPanel({ messages, isRunning, startedAt, showTimestamps = false }: RenderedOutputPanelProps) {
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
      if (!showTimestamps || !startedAt) return null;
      return (
        <span className="text-xs text-muted-foreground font-mono mr-2 flex-shrink-0" style={{ minWidth: '44px' }}>
          {formatElapsed(timestamp - startedAt)}
        </span>
      );
    };
    let i = 0;
    while (i < messages.length) {
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
        const toolUseIdx = i;
        let toolResult: AgentChatMessageToolResult | undefined;
        if (i + 1 < messages.length && messages[i + 1].type === 'tool_result') {
          const candidate = messages[i + 1] as AgentChatMessageToolResult;
          if (candidate.toolId === toolUse.toolId || !toolUse.toolId) {
            toolResult = candidate;
            i++;
          }
        }
        const Renderer = getToolRenderer(toolUse.toolName);
        nodes.push(
          <div key={toolUseIdx} className="flex">
            {ts(toolUse.timestamp)}
            <div className="flex-1 min-w-0">
              <Renderer
                toolUse={toolUse}
                toolResult={toolResult}
                expanded={expandedTools.has(toolUseIdx)}
                onToggle={() => toggleTool(toolUseIdx)}
              />
            </div>
          </div>
        );
      } else if (msg.type === 'tool_result') {
        // Orphaned tool_result
        nodes.push(
          <div key={i} className="flex">
            {ts(msg.timestamp)}
            <div className="flex-1 min-w-0 border border-border rounded p-2 my-1 text-xs">
              <span className="text-muted-foreground">Tool result:</span>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto text-xs">
                {msg.result.length > 1000 ? msg.result.slice(0, 1000) + '\n...' : msg.result}
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

      i++;
    }
    return nodes;
  }, [messages, expandedTools, toggleTool, showTimestamps, startedAt]);

  return (
    <div className="flex flex-1 min-h-0">
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
