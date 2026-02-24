import React, { useState } from 'react';
import type { AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../shared/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';

interface ToolResultPreviewProps {
  toolUse: AgentChatMessageToolUse;
  toolResult?: AgentChatMessageToolResult;
  showDiff?: boolean;
}

export function ToolResultPreview({ toolUse, toolResult, showDiff }: ToolResultPreviewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogContent, setDialogContent] = useState<{ title: string; text: string }>({ title: '', text: '' });

  const openDialog = (title: string, text: string) => {
    setDialogContent({ title, text });
    setDialogOpen(true);
  };

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
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Input</span>
            {toolUse.input.length > 500 && (
              <button className="text-xs text-primary hover:underline" onClick={() => openDialog('Input', toolUse.input)}>
                View Full
              </button>
            )}
          </div>
          <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
            {toolUse.input.length > 2000 ? toolUse.input.slice(0, 2000) + '\n...' : toolUse.input}
          </pre>
        </div>
      )}
      {toolResult && (
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Result</span>
            {toolResult.result.length > 500 && (
              <button className="text-xs text-primary hover:underline" onClick={() => openDialog('Result', toolResult.result)}>
                View Full
              </button>
            )}
          </div>
          <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto max-h-32 overflow-y-auto whitespace-pre-wrap">
            {toolResult.result.length > 2000
              ? toolResult.result.slice(0, 2000) + '\n... (truncated)'
              : toolResult.result}
          </pre>
        </div>
      )}

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
