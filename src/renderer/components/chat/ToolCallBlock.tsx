import React, { useState } from 'react';
import type { AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../shared/types';

interface ToolCallBlockProps {
  toolUse: AgentChatMessageToolUse;
  toolResult?: AgentChatMessageToolResult;
}

export function ToolCallBlock({ toolUse, toolResult }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg my-2 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-sm bg-muted/50 hover:bg-muted transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <svg className="w-4 h-4 text-muted-foreground flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
        </svg>
        <span className="font-medium text-foreground">{toolUse.toolName}</span>
        <svg
          className={`w-4 h-4 ml-auto text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-3 py-2 space-y-2">
          {toolUse.input && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">Input</span>
              <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                {toolUse.input}
              </pre>
            </div>
          )}
          {toolResult && (
            <div>
              <span className="text-xs font-medium text-muted-foreground">Result</span>
              <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                {toolResult.result.length > 2000
                  ? toolResult.result.slice(0, 2000) + '\n... (truncated)'
                  : toolResult.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
