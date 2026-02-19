import React, { useState, useMemo } from 'react';
import { Button } from '../ui/button';
import { Copy, Check } from 'lucide-react';

interface JSONOutputPanelProps {
  payload: Record<string, unknown>;
  isRunning: boolean;
}

export function JSONOutputPanel({ payload, isRunning }: JSONOutputPanelProps) {
  const [copied, setCopied] = useState(false);

  const formatted = useMemo(() => {
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return '{}';
    }
  }, [payload]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(formatted);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isRunning) {
    return (
      <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
        JSON output will be available when the agent completes.
      </div>
    );
  }

  if (!payload || Object.keys(payload).length === 0) {
    return (
      <div className="flex items-center justify-center flex-1 text-sm text-muted-foreground">
        No structured output available for this run.
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30">
        <span className="text-xs text-muted-foreground">Structured JSON output</span>
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={handleCopy} title="Copy JSON">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <pre className="text-xs bg-muted p-4 overflow-auto whitespace-pre-wrap flex-1 font-mono">
        {formatted}
      </pre>
    </div>
  );
}
