import React, { useState, useEffect, useRef } from 'react';
import { comboFromKeyEvent, formatCombo } from '../lib/keyboardShortcuts';
import { cn } from '../lib/utils';

interface KeyRecorderProps {
  value: string;
  onCapture: (combo: string) => void;
  onCancel: () => void;
  disabled?: boolean;
  hasConflict?: boolean;
}

export function KeyRecorder({ value, onCapture, onCancel, disabled = false, hasConflict = false }: KeyRecorderProps) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecording(false);
        onCancel();
        return;
      }

      // Skip Tab (reserved for focus navigation)
      if (e.key === 'Tab') return;

      const combo = comboFromKeyEvent(e);
      if (combo) {
        setRecording(false);
        onCapture(combo);
      }
    }

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, onCapture, onCancel]);

  // Cancel recording when clicking outside
  useEffect(() => {
    if (!recording) return;

    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setRecording(false);
        onCancel();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [recording, onCancel]);

  return (
    <button
      ref={ref}
      disabled={disabled}
      onClick={() => {
        if (!disabled) setRecording(true);
      }}
      className={cn(
        'inline-flex items-center justify-center min-w-[80px] px-2.5 py-1 rounded border text-sm font-mono transition-colors select-none',
        recording
          ? 'border-primary bg-primary/10 text-primary animate-pulse cursor-default'
          : hasConflict
          ? 'border-yellow-500 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/20 cursor-pointer'
          : 'border-border bg-muted text-foreground hover:bg-muted/80 cursor-pointer',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {recording ? 'Press keys…' : formatCombo(value)}
    </button>
  );
}
