import React, { useEffect, useRef } from 'react';
import type { AgentChatMessage, AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../shared/types';
import { MarkdownContent } from './MarkdownContent';
import { ToolCallBlock } from './ToolCallBlock';

interface ChatMessageListProps {
  messages: AgentChatMessage[];
  isRunning?: boolean;
}

export function ChatMessageList({ messages, isRunning }: ChatMessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Group consecutive tool_use + tool_result pairs by toolId
  const rendered: React.ReactNode[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];

    if (msg.type === 'assistant_text') {
      rendered.push(
        <div key={i} className="py-2">
          <MarkdownContent content={msg.text} />
        </div>
      );
    } else if (msg.type === 'tool_use') {
      // Look ahead for a matching tool_result
      const toolUse = msg as AgentChatMessageToolUse;
      const toolUseIdx = i; // stable key before potential increment
      let toolResult: AgentChatMessageToolResult | undefined;
      if (i + 1 < messages.length && messages[i + 1].type === 'tool_result') {
        const candidate = messages[i + 1] as AgentChatMessageToolResult;
        if (candidate.toolId === toolUse.toolId || !toolUse.toolId) {
          toolResult = candidate;
          i++; // skip the tool_result since we pair it
        }
      }
      rendered.push(
        <ToolCallBlock key={toolUseIdx} toolUse={toolUse} toolResult={toolResult} />
      );
    } else if (msg.type === 'tool_result') {
      // Orphaned tool_result (no preceding tool_use match)
      rendered.push(
        <div key={i} className="border border-border rounded p-2 my-2 text-xs">
          <span className="text-muted-foreground">Tool result:</span>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
            {msg.result.length > 2000 ? msg.result.slice(0, 2000) + '\n...' : msg.result}
          </pre>
        </div>
      );
    } else if (msg.type === 'user') {
      rendered.push(
        <div key={i} className="flex justify-end py-2">
          <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2 max-w-[80%]">
            <p className="text-sm">{msg.text}</p>
          </div>
        </div>
      );
    } else if (msg.type === 'status') {
      rendered.push(
        <div key={i} className="text-center py-2">
          <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
            {msg.message}
          </span>
        </div>
      );
    } else if (msg.type === 'usage') {
      // Usage messages are rendered in the sidebar, not inline
    }

    i++;
  }

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
