import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import type { Transition } from '../../../shared/types';

interface SplitButtonProps {
  primaryTransition: Transition;
  otherForwardTransitions: Transition[];
  escapeTransitions: Transition[];
  transitioning: string | null;
  onTransition: (toStatus: string) => void;
}

export function SplitButton({
  primaryTransition,
  otherForwardTransitions,
  escapeTransitions,
  transitioning,
  onTransition,
}: SplitButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasDropdownItems = otherForwardTransitions.length > 0 || escapeTransitions.length > 0;
  const disabled = transitioning !== null;

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [open]);

  const primaryLabel =
    transitioning === primaryTransition.to
      ? 'Transitioning...'
      : (primaryTransition.label || `Move to ${primaryTransition.to}`);

  const baseClasses =
    'inline-flex items-center justify-center whitespace-nowrap text-xs font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50';

  const primaryClasses = cn(
    baseClasses,
    'h-8 px-3 rounded-l-xl bg-primary text-primary-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.25)_inset,0_8px_18px_hsl(var(--primary)/0.22)] hover:bg-primary/95 active:translate-y-px',
    !hasDropdownItems && 'rounded-r-xl'
  );

  const toggleClasses = cn(
    baseClasses,
    'h-8 w-7 rounded-r-xl bg-primary/85 text-primary-foreground border-l border-primary/40 hover:bg-primary/75 active:translate-y-px'
  );

  return (
    <div ref={containerRef} className="relative inline-flex">
      {/* Primary button */}
      <button
        className={primaryClasses}
        disabled={disabled}
        onClick={() => onTransition(primaryTransition.to)}
      >
        {primaryLabel}
      </button>

      {/* Dropdown toggle — only render when there are other items */}
      {hasDropdownItems && (
        <button
          className={toggleClasses}
          disabled={disabled}
          aria-label="More transitions"
          onClick={() => setOpen((prev) => !prev)}
        >
          <span style={{ fontSize: '10px', lineHeight: 1 }}>▾</span>
        </button>
      )}

      {/* Dropdown menu */}
      {open && hasDropdownItems && (
        <div
          className="absolute left-0 top-full mt-1 z-50 min-w-[10rem] rounded-xl border border-border/80 bg-popover shadow-md py-1"
          style={{ minWidth: '160px' }}
        >
          {otherForwardTransitions.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Other transitions
              </div>
              {otherForwardTransitions.map((t) => (
                <button
                  key={t.to}
                  className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent/55 disabled:opacity-50 disabled:pointer-events-none"
                  disabled={disabled}
                  onClick={() => {
                    setOpen(false);
                    onTransition(t.to);
                  }}
                >
                  {t.label || `Move to ${t.to}`}
                </button>
              ))}
            </>
          )}

          {otherForwardTransitions.length > 0 && escapeTransitions.length > 0 && (
            <div className="my-1 border-t border-border/60" />
          )}

          {escapeTransitions.length > 0 && (
            <>
              {escapeTransitions.map((t) => (
                <button
                  key={t.to}
                  className="w-full text-left px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/55 disabled:opacity-50 disabled:pointer-events-none"
                  disabled={disabled}
                  onClick={() => {
                    setOpen(false);
                    onTransition(t.to);
                  }}
                >
                  {t.label || `Move to ${t.to}`}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
