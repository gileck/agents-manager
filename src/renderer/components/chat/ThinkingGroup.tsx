import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AgentChatMessage, AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../shared/types';
import { ThinkingBlock } from './ThinkingBlock';
import { getToolRenderer } from '../tool-renderers';

interface ThinkingGroupProps {
  messages: AgentChatMessage[];
  startIndex: number;
  expandedTools: Set<number>;
  onToggleTool: (index: number) => void;
}

export function ThinkingGroup({ messages, startIndex, expandedTools, onToggleTool }: ThinkingGroupProps) {
  const [expanded, setExpanded] = useState(false);

  const { durationS, toolNames, totalTokens } = useMemo(() => {
    const first = messages[0];
    const last = messages[messages.length - 1];
    const durationMs = last.timestamp - first.timestamp;
    const durationSec = (durationMs / 1000).toFixed(1);

    const seenTools = new Set<string>();
    const names: string[] = [];
    let tokens = 0;

    for (const msg of messages) {
      if (msg.type === 'tool_use') {
        if (!seenTools.has(msg.toolName)) {
          seenTools.add(msg.toolName);
          names.push(msg.toolName);
        }
      } else if (msg.type === 'usage') {
        tokens += msg.inputTokens + msg.outputTokens;
      }
    }

    return { durationS: durationSec, toolNames: names, totalTokens: tokens };
  }, [messages]);

  const resultMap = useMemo(() => {
    const map = new Map<string, AgentChatMessageToolResult>();
    for (const msg of messages) {
      if (msg.type === 'tool_result' && msg.toolId) {
        map.set(msg.toolId, msg as AgentChatMessageToolResult);
      }
    }
    return map;
  }, [messages]);

  const expandedContent = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    const matchedResultIds = new Set<string>();

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const globalIndex = startIndex + i;

      if (msg.type === 'thinking') {
        nodes.push(<ThinkingBlock key={i} text={msg.text} />);
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
            expanded={expandedTools.has(globalIndex)}
            onToggle={() => onToggleTool(globalIndex)}
          />
        );
      } else if (msg.type === 'tool_result') {
        const result = msg as AgentChatMessageToolResult;
        if (result.toolId && matchedResultIds.has(result.toolId)) continue;
        nodes.push(
          <div key={i} className="border border-border rounded p-2 my-2 text-xs">
            <span className="text-muted-foreground">Tool result:</span>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
              {result.result.length > 2000 ? result.result.slice(0, 2000) + '\n...' : result.result}
            </pre>
          </div>
        );
      }
    }

    return nodes;
  }, [messages, startIndex, expandedTools, onToggleTool, resultMap]);

  const toolsSummary =
    toolNames.length > 0
      ? toolNames.slice(0, 3).join(', ') + (toolNames.length > 3 ? ` +${toolNames.length - 3}` : '')
      : null;

  return (
    <div className="my-1">
      <button
        type="button"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground/80 transition-colors py-1 px-2 rounded-md hover:bg-muted/40 w-full text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        )}
        <span className="text-muted-foreground/70">Thinking</span>
        <span className="text-muted-foreground/35">·</span>
        <span>{durationS}s</span>
        {toolsSummary && (
          <>
            <span className="text-muted-foreground/35">·</span>
            <span className="truncate max-w-[280px]">{toolsSummary}</span>
          </>
        )}
        {totalTokens > 0 && (
          <>
            <span className="text-muted-foreground/35">·</span>
            <span>{totalTokens.toLocaleString()} tokens</span>
          </>
        )}
      </button>
      {expanded && (
        <div className="ml-3 mt-0.5 pl-3 border-l border-border/40">
          {expandedContent}
        </div>
      )}
    </div>
  );
}
