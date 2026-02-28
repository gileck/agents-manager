import React, { useState } from 'react';

interface ThinkingBlockProps {
  text: string;
  timestamp?: number;
  ts?: (t: number) => React.ReactNode;
}

export function ThinkingBlock({ text, timestamp, ts }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 300;
  const displayText = isLong && !expanded ? text.slice(0, 300) + '...' : text;

  const content = (
    <div className="border-l-2 border-purple-400/50 pl-3">
      <div className="flex items-center gap-1.5 text-xs text-purple-400 mb-0.5">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11zM8 4a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 4zm0 6.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
        </svg>
        Thinking
      </div>
      <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{displayText}</p>
      {isLong && (
        <button
          className="text-xs text-purple-400 mt-1 hover:underline"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );

  if (ts && timestamp) {
    return (
      <div className="flex py-1">
        {ts(timestamp)}
        <div className="flex-1 min-w-0">{content}</div>
      </div>
    );
  }
  return <div className="my-2 py-1">{content}</div>;
}
