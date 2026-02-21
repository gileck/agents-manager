import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn, formatDuration } from '@template/renderer/lib/utils';
import {
  ArrowDownToLine,
  Copy,
  Check,
  Search,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

interface OutputToolbarProps {
  autoScroll: boolean;
  onAutoScrollToggle: () => void;
  outputText: string;
  searchTerm: string;
  onSearchChange: (term: string) => void;
  matchCount: number;
  currentMatch: number;
  onPrevMatch: () => void;
  onNextMatch: () => void;
  startedAt: number;
  isRunning: boolean;
  timeoutMs?: number | null;
  maxTurns?: number | null;
  messageCount?: number | null;
}

export function OutputToolbar({
  autoScroll,
  onAutoScrollToggle,
  outputText,
  searchTerm,
  onSearchChange,
  matchCount,
  currentMatch,
  onPrevMatch,
  onNextMatch,
  startedAt,
  isRunning,
  timeoutMs,
  maxTurns,
  messageCount,
}: OutputToolbarProps) {
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    const update = () => setElapsed(formatDuration(Date.now() - startedAt));
    update();
    if (!isRunning) return;
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [startedAt, isRunning]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30">
      <Button
        variant="ghost"
        size="icon"
        className={cn('h-7 w-7', autoScroll && 'bg-accent text-accent-foreground')}
        onClick={onAutoScrollToggle}
        title="Auto-scroll"
      >
        <ArrowDownToLine className="h-3.5 w-3.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={handleCopy}
        title="Copy output"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>

      <div className="flex items-center gap-1 ml-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search..."
          className="h-7 w-40 text-xs"
        />
        {searchTerm && (
          <>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {matchCount > 0 ? `${currentMatch + 1}/${matchCount}` : '0/0'}
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onPrevMatch} disabled={matchCount === 0}>
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onNextMatch} disabled={matchCount === 0}>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        {messageCount != null && messageCount > 0 && (
          <span className="text-xs text-muted-foreground font-mono">
            Msgs: {messageCount}{maxTurns ? ` / ${maxTurns}` : ''}
          </span>
        )}
        <span className="text-xs text-muted-foreground font-mono">
          {elapsed}{timeoutMs ? ` / ${formatDuration(timeoutMs)}` : ''}
        </span>
      </div>
    </div>
  );
}
