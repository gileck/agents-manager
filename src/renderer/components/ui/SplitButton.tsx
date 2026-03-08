import React, { useState, useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import type { Transition } from '../../../shared/types';

function TransitionIcon({ label, to }: { label?: string; to: string }) {
  const text = (label ?? to).toLowerCase();
  // SVG icons — 14x14, stroke-based
  const props = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { flexShrink: 0 } as React.CSSProperties };

  if (text.includes('investigat')) return <svg {...props}><circle cx="7" cy="7" r="4.5" /><line x1="10.2" y1="10.2" x2="14" y2="14" /></svg>;
  if (text.includes('design'))    return <svg {...props}><path d="M2 2h5l7 7-5 5-7-7V2z" /><circle cx="5.5" cy="5.5" r="0.5" fill="currentColor" stroke="none" /></svg>;
  if (text.includes('plan'))      return <svg {...props}><rect x="2" y="2" width="12" height="12" rx="2" /><line x1="5" y1="6" x2="11" y2="6" /><line x1="5" y1="9" x2="9" y2="9" /></svg>;
  if (text.includes('implement')) return <svg {...props}><polyline points="4 5 7 8 4 11" /><line x1="9" y1="11" x2="13" y2="11" /></svg>;
  if (text.includes('backlog'))   return <svg {...props}><path d="M3 7l5-3.5L13 7l-5 3.5L3 7z" /><path d="M3 9.5l5 3.5 5-3.5" /><path d="M3 12l5 3.5 5-3.5" /></svg>;
  if (text.includes('close'))     return <svg {...props}><line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" /></svg>;
  if (text.includes('cancel'))    return <svg {...props}><circle cx="8" cy="8" r="6" /><line x1="5.5" y1="5.5" x2="10.5" y2="10.5" /></svg>;
  if (text.includes('review'))    return <svg {...props}><path d="M2 8c2-4 10-4 12 0-2 4-10 4-12 0z" /><circle cx="8" cy="8" r="2" /></svg>;
  if (text.includes('approve') || text.includes('merge')) return <svg {...props}><polyline points="3 8 6.5 11.5 13 5" /></svg>;
  if (text.includes('reopen'))    return <svg {...props}><polyline points="4 10 4 4 10 4" /><path d="M4 4l8 8" /></svg>;
  // fallback: arrow-right
  return <svg {...props}><line x1="3" y1="8" x2="13" y2="8" /><polyline points="9 4 13 8 9 12" /></svg>;
}

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
    'h-8 px-3 rounded-l-xl bg-green-600 text-white shadow-[0_0_0_1px_rgba(22,163,74,0.25)_inset,0_8px_18px_rgba(22,163,74,0.22)] hover:bg-green-700 active:translate-y-px',
    !hasDropdownItems && 'rounded-r-xl'
  );

  const toggleClasses = cn(
    baseClasses,
    'h-8 w-7 rounded-r-xl bg-green-600/85 text-white border-l border-green-500/40 hover:bg-green-700/75 active:translate-y-px'
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
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ display: 'block' }}>
            <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Dropdown menu */}
      {open && hasDropdownItems && (
        <div
          className="absolute left-0 top-full mt-1 z-50 min-w-[10rem] rounded-xl border border-border/80 bg-popover shadow-md py-1"
          style={{ minWidth: '180px' }}
        >
          {otherForwardTransitions.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Other transitions
              </div>
              {otherForwardTransitions.map((t) => (
                <button
                  key={t.to}
                  className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent/55 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
                  disabled={disabled}
                  onClick={() => {
                    setOpen(false);
                    onTransition(t.to);
                  }}
                >
                  <TransitionIcon label={t.label} to={t.to} />
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
                  className="w-full text-left px-3 py-1.5 text-sm text-foreground/70 hover:text-foreground hover:bg-accent/55 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
                  disabled={disabled}
                  onClick={() => {
                    setOpen(false);
                    onTransition(t.to);
                  }}
                >
                  <TransitionIcon label={t.label} to={t.to} />
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
