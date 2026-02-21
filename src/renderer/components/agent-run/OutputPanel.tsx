import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { OutputToolbar } from './OutputToolbar';
import { stripAnsi } from '@template/renderer/lib/utils';

interface OutputPanelProps {
  output: string;
  startedAt: number;
  isRunning: boolean;
  timeoutMs?: number | null;
  maxTurns?: number | null;
  messageCount?: number | null;
}

export function OutputPanel({ output, startedAt, isRunning, timeoutMs, maxTurns, messageCount }: OutputPanelProps) {
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentMatch, setCurrentMatch] = useState(0);
  const preRef = useRef<HTMLPreElement>(null);
  const matchRefs = useRef<(HTMLElement | null)[]>([]);

  const cleanOutput = useMemo(() => stripAnsi(output), [output]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setCurrentMatch(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Compute matches
  const matches = useMemo(() => {
    if (!debouncedSearch) return [];
    const indices: number[] = [];
    const lower = cleanOutput.toLowerCase();
    const term = debouncedSearch.toLowerCase();
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(term, pos);
      if (idx === -1) break;
      indices.push(idx);
      pos = idx + 1;
    }
    return indices;
  }, [cleanOutput, debouncedSearch]);

  // Build highlighted content
  const highlighted = useMemo(() => {
    if (!debouncedSearch || matches.length === 0) return cleanOutput;

    matchRefs.current = [];
    const parts: React.ReactNode[] = [];
    let lastEnd = 0;
    const termLen = debouncedSearch.length;

    matches.forEach((matchIdx, i) => {
      if (matchIdx > lastEnd) {
        parts.push(cleanOutput.slice(lastEnd, matchIdx));
      }
      parts.push(
        <mark
          key={i}
          ref={(el) => { matchRefs.current[i] = el; }}
          className={i === currentMatch ? 'bg-yellow-400 text-black' : 'bg-yellow-200 text-black'}
        >
          {cleanOutput.slice(matchIdx, matchIdx + termLen)}
        </mark>
      );
      lastEnd = matchIdx + termLen;
    });
    if (lastEnd < cleanOutput.length) {
      parts.push(cleanOutput.slice(lastEnd));
    }
    return parts;
  }, [cleanOutput, debouncedSearch, matches, currentMatch]);

  // Auto-scroll
  useEffect(() => {
    if (preRef.current && autoScroll) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  // Scroll to current match
  useEffect(() => {
    if (matchRefs.current[currentMatch]) {
      matchRefs.current[currentMatch]!.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [currentMatch, debouncedSearch]);

  const handleScroll = useCallback(() => {
    if (!preRef.current) return;
    const el = preRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  const handlePrev = () => {
    setCurrentMatch((c) => (c > 0 ? c - 1 : matches.length - 1));
  };
  const handleNext = () => {
    setCurrentMatch((c) => (c < matches.length - 1 ? c + 1 : 0));
  };

  return (
    <div className="flex flex-col border rounded-md overflow-hidden flex-1 min-h-0">
      <OutputToolbar
        autoScroll={autoScroll}
        onAutoScrollToggle={() => setAutoScroll((s) => !s)}
        outputText={cleanOutput}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        matchCount={matches.length}
        currentMatch={currentMatch}
        onPrevMatch={handlePrev}
        onNextMatch={handleNext}
        startedAt={startedAt}
        isRunning={isRunning}
        timeoutMs={timeoutMs}
        maxTurns={maxTurns}
        messageCount={messageCount}
      />
      <pre
        ref={preRef}
        onScroll={handleScroll}
        className="text-xs bg-muted p-4 overflow-auto whitespace-pre-wrap flex-1"
        style={{ minHeight: '200px' }}
      >
        {typeof highlighted === 'string' && !highlighted
          ? (isRunning ? 'Waiting for output...' : '')
          : highlighted}
      </pre>
    </div>
  );
}
