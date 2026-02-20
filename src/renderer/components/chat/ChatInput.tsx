import React, { useState } from 'react';
import { Button } from '../ui/button';

interface ChatInputProps {
  onSend: (message: string) => void;
  onStop?: () => void;
  isRunning: boolean;
  isQueued: boolean;
}

export function ChatInput({ onSend, onStop, isRunning, isQueued }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-border px-4 py-3 flex items-end gap-2">
      <textarea
        className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[40px] max-h-[120px] focus:outline-none focus:ring-2 focus:ring-ring"
        placeholder={isRunning ? 'Type a message (will be queued)...' : 'Type a message...'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
      />
      <div className="flex gap-1">
        {isRunning && onStop && (
          <Button type="button" variant="destructive" size="sm" onClick={onStop}>
            Stop
          </Button>
        )}
        <Button type="submit" size="sm" disabled={!value.trim()}>
          {isRunning ? 'Queue' : 'Send'}
        </Button>
      </div>
      {isQueued && (
        <span className="text-xs text-muted-foreground ml-1">Message queued</span>
      )}
    </form>
  );
}
