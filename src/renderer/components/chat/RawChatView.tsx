import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import type { RawEvent } from '../../hooks/useChat';

interface Props {
  rawEvents: RawEvent[];
}

const CHANNEL_COLORS: Record<string, string> = {
  'chat:output': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'chat:message': 'bg-green-500/20 text-green-400 border-green-500/30',
  'chat:stream-delta': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'chat:permission-request': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'chat:agent-notification': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
};

function getChannelColor(channel: string): string {
  return CHANNEL_COLORS[channel] ?? 'bg-muted/40 text-muted-foreground border-border/50';
}

/** Splits `text` on the first occurrence of `query` (case-insensitive) and returns JSX with <mark> spans. */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQuery, lastIndex);
  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx));
    }
    parts.push(
      <mark key={idx} className="bg-yellow-300/70 text-inherit rounded-sm">
        {text.slice(idx, idx + query.length)}
      </mark>,
    );
    lastIndex = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return <>{parts}</>;
}

/** Count non-overlapping occurrences of `query` in `text` (case-insensitive). */
function countMatches(text: string, query: string): number {
  if (!query) return 0;
  let count = 0;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let idx = lowerText.indexOf(lowerQuery);
  while (idx !== -1) {
    count++;
    idx = lowerText.indexOf(lowerQuery, idx + lowerQuery.length);
  }
  return count;
}

interface EventBlockProps {
  event: RawEvent;
  searchQuery: string;
}

function EventBlock({ event, searchQuery }: EventBlockProps) {
  const jsonText = JSON.stringify(event.payload, null, 2);
  const channelColor = getChannelColor(event.channel);

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden bg-card/30">
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/20 border-b border-border/30">
        <span className="text-[11px] text-muted-foreground font-mono shrink-0">
          {highlightText(event.timestamp, searchQuery)}
        </span>
        <span
          className={`text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded border ${channelColor} shrink-0`}
        >
          {highlightText(event.channel, searchQuery)}
        </span>
      </div>
      {/* JSON payload */}
      <pre className="px-3 py-2 text-[11px] font-mono text-foreground/90 whitespace-pre-wrap break-all leading-relaxed overflow-x-auto">
        {highlightText(jsonText, searchQuery)}
      </pre>
    </div>
  );
}

export function RawChatView({ rawEvents }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute total match count across all events
  const matchCount = useMemo(() => {
    if (!searchQuery) return 0;
    return rawEvents.reduce((total, evt) => {
      const combined =
        evt.timestamp + '\n' + evt.channel + '\n' + JSON.stringify(evt.payload, null, 2);
      return total + countMatches(combined, searchQuery);
    }, 0);
  }, [rawEvents, searchQuery]);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo({ top: containerRef.current.scrollHeight });
    }
  }, [rawEvents.length]);

  const copyAll = useCallback(() => {
    const text = rawEvents
      .map((e) => `[${e.timestamp}] [${e.channel}]\n${JSON.stringify(e.payload, null, 2)}`)
      .join('\n---\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback: silently fail (clipboard not available)
    });
  }, [rawEvents]);

  return (
    <div className="flex flex-col flex-1 min-h-0 font-mono text-sm">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-muted/20 shrink-0">
        <div className="relative flex-1 max-w-sm">
          <input
            type="text"
            placeholder="Search events…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs bg-card/60 border border-border/60 rounded-full px-3 py-1.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring/50"
          />
        </div>
        {searchQuery && (
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {matchCount} {matchCount === 1 ? 'match' : 'matches'}
          </span>
        )}
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded shrink-0"
            title="Clear search"
          >
            ×
          </button>
        )}
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground shrink-0">
          {rawEvents.length} {rawEvents.length === 1 ? 'event' : 'events'}
        </span>
        <button
          onClick={copyAll}
          disabled={rawEvents.length === 0}
          className="text-xs px-3 py-1.5 rounded-full border border-border/60 bg-card/65 text-muted-foreground hover:text-foreground hover:bg-accent/65 transition-colors disabled:opacity-40 disabled:pointer-events-none shrink-0"
          title="Copy all events to clipboard"
        >
          {copied ? 'Copied!' : 'Copy All'}
        </button>
      </div>

      {/* Event list */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
      >
        {rawEvents.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground/60 text-xs">
            No events yet — WebSocket events will appear here as they arrive.
          </div>
        ) : (
          rawEvents.map((evt, i) => (
            <EventBlock key={i} event={evt} searchQuery={searchQuery} />
          ))
        )}
      </div>
    </div>
  );
}
