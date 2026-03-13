import React, { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { cn, formatDuration } from '../../lib/utils';
import {
  ArrowDownToLine,
  Copy,
  Check,
  Search,
  ChevronUp,
  ChevronDown,
  Clock,
  Activity,
} from 'lucide-react';
import type { PostProcessingLogCategory } from '../../../shared/types';
import { CATEGORY_LABELS } from './RenderedOutputPanel';

export type OutputMode = 'raw' | 'rendered';

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
  outputMode?: OutputMode;
  onOutputModeChange?: (mode: OutputMode) => void;
  hasOutput?: boolean;
  showTimestamps?: boolean;
  onShowTimestampsToggle?: () => void;
  hasPostProcessingLogs?: boolean;
  showPostProcessingLogs?: boolean;
  onTogglePostProcessingLogs?: () => void;
  activePostLogCategories?: Set<PostProcessingLogCategory>;
  onTogglePostLogCategory?: (category: PostProcessingLogCategory) => void;
}

const ALL_CATEGORIES: PostProcessingLogCategory[] = ['validation', 'git', 'pipeline', 'extraction', 'notification', 'system'];

const CATEGORY_CHIP_COLORS: Record<PostProcessingLogCategory, string> = {
  validation: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/25',
  git: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30 hover:bg-orange-500/25',
  pipeline: 'bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30 hover:bg-purple-500/25',
  extraction: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/30 hover:bg-cyan-500/25',
  notification: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 hover:bg-green-500/25',
  system: 'bg-slate-500/15 text-slate-700 dark:text-slate-400 border-slate-500/30 hover:bg-slate-500/25',
};

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
  outputMode = 'raw',
  onOutputModeChange,
  hasOutput = false,
  showTimestamps = false,
  onShowTimestampsToggle,
  hasPostProcessingLogs = false,
  showPostProcessingLogs = false,
  onTogglePostProcessingLogs,
  activePostLogCategories,
  onTogglePostLogCategory,
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
      {onOutputModeChange && (
        <div className={cn('flex items-center border border-border rounded overflow-hidden mr-1', !hasOutput && 'opacity-50')}>
          <button
            className={cn(
              'px-2 py-1 text-xs font-medium transition-colors',
              outputMode === 'raw' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onOutputModeChange('raw')}
            disabled={!hasOutput}
          >
            Raw
          </button>
          <button
            className={cn(
              'px-2 py-1 text-xs font-medium transition-colors',
              outputMode === 'rendered' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => onOutputModeChange('rendered')}
            disabled={!hasOutput}
          >
            Rendered
          </button>
        </div>
      )}

      {outputMode === 'rendered' && onShowTimestampsToggle && (
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-7 w-7', showTimestamps && 'bg-accent text-accent-foreground')}
          onClick={onShowTimestampsToggle}
          title="Toggle timestamps"
        >
          <Clock className="h-3.5 w-3.5" />
        </Button>
      )}

      {outputMode === 'rendered' && hasPostProcessingLogs && onTogglePostProcessingLogs && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-7 gap-1 px-2 text-xs', showPostProcessingLogs && 'bg-accent text-accent-foreground')}
            onClick={onTogglePostProcessingLogs}
            title="Toggle post-processing logs"
          >
            <Activity className="h-3.5 w-3.5" />
            Post-processing
          </Button>
          {showPostProcessingLogs && onTogglePostLogCategory && (
            <div className="flex items-center gap-1">
              {ALL_CATEGORIES.map((cat) => {
                const isActive = !activePostLogCategories || activePostLogCategories.size === 0 || activePostLogCategories.has(cat);
                return (
                  <button
                    key={cat}
                    className={cn(
                      'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer',
                      CATEGORY_CHIP_COLORS[cat],
                      !isActive && 'opacity-40'
                    )}
                    onClick={() => onTogglePostLogCategory(cat)}
                    title={`Toggle ${CATEGORY_LABELS[cat]} logs`}
                  >
                    {CATEGORY_LABELS[cat]}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

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
