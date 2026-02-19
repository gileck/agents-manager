import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Copy, Check } from 'lucide-react';

interface PromptPanelProps {
  prompt: string | null;
}

export function PromptPanel({ prompt }: PromptPanelProps) {
  const [copied, setCopied] = useState(false);

  const displayText = prompt || 'No prompt recorded for this run.';

  const handleCopy = async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30">
        <span className="text-xs text-muted-foreground">Actual prompt sent to agent</span>
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={handleCopy} disabled={!prompt} title="Copy prompt">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre className="text-xs bg-muted p-4 overflow-auto whitespace-pre-wrap flex-1">
        {displayText}
      </pre>
    </div>
  );
}
