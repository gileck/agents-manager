import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Copy, Check } from 'lucide-react';
import type { TaskContextEntry } from '../../../shared/types';

interface PromptPanelProps {
  taskTitle: string;
  taskDescription: string | null;
  taskPlan: string | null;
  mode: string;
  agentType: string;
  contextEntries: TaskContextEntry[];
}

export function PromptPanel({ taskTitle, taskDescription, taskPlan, mode, agentType, contextEntries }: PromptPanelProps) {
  const [copied, setCopied] = useState(false);

  // Reconstruct an approximation of the prompt that was sent
  const sections: string[] = [];

  sections.push(`# Agent: ${agentType} (${mode} mode)`);
  sections.push(`\n## Task: ${taskTitle}`);
  if (taskDescription) {
    sections.push(`\n${taskDescription}`);
  }
  if (taskPlan) {
    sections.push(`\n## Plan\n${taskPlan}`);
  }

  if (contextEntries.length > 0) {
    sections.push('\n## Task Context\n');
    for (const entry of contextEntries) {
      const ts = new Date(entry.createdAt).toISOString();
      sections.push(`### [${entry.source}] ${entry.entryType} (${ts})\n${entry.summary}\n`);
    }
  }

  const fullText = sections.join('\n');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30">
        <span className="text-xs text-muted-foreground">Prompt context sent to agent</span>
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={handleCopy} title="Copy prompt">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre className="text-xs bg-muted p-4 overflow-auto whitespace-pre-wrap flex-1">
        {fullText}
      </pre>
    </div>
  );
}
