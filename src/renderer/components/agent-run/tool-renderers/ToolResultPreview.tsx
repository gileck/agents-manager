import React from 'react';
import type { AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../../shared/types';

interface ToolResultPreviewProps {
  toolUse: AgentChatMessageToolUse;
  toolResult?: AgentChatMessageToolResult;
  showDiff?: boolean;
}

export function ToolResultPreview({ toolUse, toolResult, showDiff }: ToolResultPreviewProps) {
  let diffPreview: React.ReactNode = null;
  if (showDiff) {
    try {
      const parsed = JSON.parse(toolUse.input);
      if (parsed.old_string && parsed.new_string) {
        diffPreview = (
          <div className="mb-2">
            <span className="text-xs font-medium text-muted-foreground">Diff</span>
            <pre className="text-xs p-2 rounded mt-1 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
              <span style={{ color: '#ef4444' }}>- {parsed.old_string}</span>
              {'\n'}
              <span style={{ color: '#22c55e' }}>+ {parsed.new_string}</span>
            </pre>
          </div>
        );
      }
    } catch { /* not JSON */ }
  }

  return (
    <div className="px-3 py-2 space-y-2 border-t border-border">
      {diffPreview}
      {!showDiff && toolUse.input && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">Input</span>
          <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
            {toolUse.input.length > 2000 ? toolUse.input.slice(0, 2000) + '\n...' : toolUse.input}
          </pre>
        </div>
      )}
      {toolResult && (
        <div>
          <span className="text-xs font-medium text-muted-foreground">Result</span>
          <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
            {toolResult.result.length > 2000
              ? toolResult.result.slice(0, 2000) + '\n... (truncated)'
              : toolResult.result}
          </pre>
        </div>
      )}
    </div>
  );
}
