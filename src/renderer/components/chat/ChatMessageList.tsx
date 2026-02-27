import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { AgentChatMessage, AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../shared/types';
import { MarkdownContent } from './MarkdownContent';
import { getToolRenderer } from '../tool-renderers';

interface ChatMessageListProps {
  messages: AgentChatMessage[];
  isRunning?: boolean;
}

export function ChatMessageList({ messages, isRunning }: ChatMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
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
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const rendered = useMemo(() => {
    // Pre-build toolId → toolResult map so parallel tool calls get matched
    const resultMap = new Map<string, AgentChatMessageToolResult>();
    for (const msg of messages) {
      if (msg.type === 'tool_result' && msg.toolId) {
        resultMap.set(msg.toolId, msg as AgentChatMessageToolResult);
      }
    }
    const matchedResultIds = new Set<string>();

    const nodes: React.ReactNode[] = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (msg.type === 'assistant_text') {
        nodes.push(
          <div key={i} className="py-2">
            <MarkdownContent content={msg.text} />
          </div>
        );
      } else if (msg.type === 'tool_use') {
        const toolUse = msg as AgentChatMessageToolUse;
        const toolResult = toolUse.toolId ? resultMap.get(toolUse.toolId) : undefined;
        if (toolResult?.toolId) matchedResultIds.add(toolResult.toolId);
        const Renderer = getToolRenderer(toolUse.toolName);
        nodes.push(
          <Renderer
            key={i}
            toolUse={toolUse}
            toolResult={toolResult}
            expanded={expandedTools.has(i)}
            onToggle={() => toggleTool(i)}
          />
        );
      } else if (msg.type === 'tool_result') {
        const result = msg as AgentChatMessageToolResult;
        if (result.toolId && matchedResultIds.has(result.toolId)) continue; // already paired
        nodes.push(
          <div key={i} className="border border-border rounded p-2 my-2 text-xs">
            <span className="text-muted-foreground">Tool result:</span>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
              {result.result.length > 2000 ? result.result.slice(0, 2000) + '\n...' : result.result}
            </pre>
          </div>
        );
      } else if (msg.type === 'user') {
        nodes.push(
          <div key={i} className="flex justify-end py-2">
            <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[80%]">
              <p className="text-sm">{msg.text}</p>
              {msg.images && msg.images.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {msg.images.map((img, j) => (
                    <img
                      key={j}
                      src={`file://${img.path}`}
                      alt={img.name || 'Attached image'}
                      className="rounded border border-primary-foreground/20 object-cover cursor-pointer"
                      style={{ maxHeight: 192, maxWidth: 256 }}
                      onClick={() => window.open(`file://${img.path}`, '_blank')}
                      onError={(e) => {
                        const el = e.target as HTMLImageElement;
                        el.style.display = 'none';
                        const placeholder = document.createElement('span');
                        placeholder.className = 'text-xs opacity-60';
                        placeholder.textContent = `Image unavailable: ${img.name || 'file removed'}`;
                        el.parentElement?.appendChild(placeholder);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      } else if (msg.type === 'status') {
        nodes.push(
          <div key={i} className="text-center py-2">
            <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
              {msg.message}
            </span>
          </div>
        );
      }
      // usage messages are skipped
    }
    return nodes;
  }, [messages, expandedTools, toggleTool]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2">
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
  );
}
