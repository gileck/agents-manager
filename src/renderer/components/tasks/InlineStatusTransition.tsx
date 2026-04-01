import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Check } from 'lucide-react';
import type { Task, Pipeline, PipelineStatus, Transition } from '../../../shared/types';

const NAMED_COLOR_CSS: Record<string, string> = {
  blue: '#3b82f6',
  gray: '#6b7280',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
};

function resolveStatusColor(status: PipelineStatus): string | undefined {
  const color = status.color;
  if (!color) return undefined;
  if (color.startsWith('#')) return color;
  return NAMED_COLOR_CSS[color];
}

interface InlineStatusTransitionProps {
  task: Task;
  pipeline: Pipeline | null;
  onStatusChange: (taskId: string, toStatus: string) => Promise<void>;
  /** Render style: 'dot' renders a small colored dot + text, 'badge' renders a PipelineBadge-style element */
  variant?: 'dot' | 'badge';
}

/**
 * Clickable inline status indicator that shows a dropdown of available
 * transitions when clicked, allowing status changes without navigating away.
 */
export function InlineStatusTransition({
  task,
  pipeline,
  onStatusChange,
  variant = 'dot',
}: InlineStatusTransitionProps) {
  const [open, setOpen] = useState(false);
  const [transitions, setTransitions] = useState<Transition[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  // Resolve current status dot color
  const statusDef = pipeline?.statuses.find((s) => s.name === task.status);
  const dotColor = statusDef ? resolveStatusColor(statusDef) : undefined;

  // Position the dropdown
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const estimatedMenuHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openUp = spaceBelow < estimatedMenuHeight && rect.top > spaceBelow;

    setMenuStyle({
      top: openUp ? 'auto' : rect.bottom + gap,
      bottom: openUp ? window.innerHeight - rect.top + gap : 'auto',
      left: rect.left,
    });
  }, []);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Reposition on scroll/resize
  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  // Lazy-load transitions when opened
  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    setTransitions(null);
    window.api.tasks
      .transitions(task.id)
      .then((r) => setTransitions(r.transitions))
      .catch(() => setLoadError('Failed to load transitions'));
  }, [open, task.id]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setOpen((prev) => !prev);
  }, []);

  const handleTransition = useCallback(async (toStatus: string) => {
    if (transitioning) return;
    setTransitioning(toStatus);
    try {
      await onStatusChange(task.id, toStatus);
      setOpen(false);
    } finally {
      setTransitioning(null);
    }
  }, [onStatusChange, task.id, transitioning]);

  const statuses: PipelineStatus[] = pipeline?.statuses ?? [];
  const availableTargets = new Set(transitions?.map((t) => t.to) ?? []);

  return (
    <>
      <button
        ref={triggerRef}
        className={`inline-flex items-center gap-1.5 cursor-pointer transition-colors rounded px-1 -mx-1 ${
          open ? 'bg-accent' : 'hover:bg-accent/50'
        }`}
        onClick={handleToggle}
        title="Click to change status"
      >
        {variant === 'dot' && (
          <>
            <span
              className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/40"
              style={dotColor ? { backgroundColor: dotColor } : undefined}
            />
            <span className="text-muted-foreground">{task.status}</span>
          </>
        )}
        {variant === 'badge' && (
          <span className="text-muted-foreground">{statusDef?.label || task.status}</span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="fixed z-[80] min-w-[180px] max-w-[240px] rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b">
            Change Status
          </div>

          {!pipeline && (
            <div className="px-3 py-3 text-xs text-muted-foreground">No statuses available</div>
          )}

          {pipeline && transitions === null && !loadError && (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </div>
          )}

          {loadError && (
            <div className="px-3 py-3 text-xs text-destructive">{loadError}</div>
          )}

          {pipeline && transitions !== null && (
            <div className="py-1 max-h-64 overflow-y-auto">
              {statuses.map((s) => {
                const isCurrent = s.name === task.status;
                const isAvailable = availableTargets.has(s.name);
                const isTransitioning = transitioning === s.name;
                const disabled = isCurrent || !isAvailable || transitioning !== null;
                const color = resolveStatusColor(s);

                return (
                  <button
                    key={s.name}
                    className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left transition-colors ${
                      isCurrent
                        ? 'font-semibold bg-accent/50'
                        : isAvailable && !transitioning
                          ? 'hover:bg-accent cursor-pointer'
                          : 'opacity-40 cursor-not-allowed'
                    }`}
                    disabled={disabled}
                    onClick={() => { if (!disabled) handleTransition(s.name); }}
                  >
                    {isTransitioning ? (
                      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    ) : (
                      <span
                        className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                          !isCurrent && !isAvailable ? 'bg-muted-foreground/30' : color ? '' : 'bg-foreground'
                        }`}
                        style={color && (isCurrent || isAvailable) ? { backgroundColor: color } : undefined}
                      />
                    )}
                    <span className="flex-1 truncate">{s.label || s.name}</span>
                    {isCurrent && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
