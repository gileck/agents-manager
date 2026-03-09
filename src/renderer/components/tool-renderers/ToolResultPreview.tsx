import React, { useState } from 'react';
import type { AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../shared/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { renderToolContent } from './renderUtils';

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
            <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium mb-1">Diff</span>
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
    <div className="border-t border-border divide-y divide-border">
      {diffPreview && (
        <div className="px-3 py-2">
          {diffPreview}
        </div>
      )}
      {!showDiff && toolUse.input && (
        <div className="px-3 py-2 bg-muted/30">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">Input</span>
            {toolUse.input.length > 500 && (
              <button className="text-xs text-primary hover:underline" onClick={() => openDialog('Input', toolUse.input)}>
                View Full
              </button>
            )}
          </div>
          <div className="bg-background rounded border border-border p-2 overflow-x-auto max-h-32 overflow-y-auto">
            {renderToolContent(toolUse.input, 2000)}
          </div>
        </div>
      )}
      {toolResult && (
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">Result</span>
            {toolResult.result.length > 500 && (
              <button className="text-xs text-primary hover:underline" onClick={() => openDialog('Result', toolResult.result)}>
                View Full
              </button>
            )}
          </div>
          <div className="bg-muted/50 rounded border border-border p-2 overflow-x-auto max-h-32 overflow-y-auto">
            {renderToolContent(toolResult.result, 2000)}
          </div>
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
