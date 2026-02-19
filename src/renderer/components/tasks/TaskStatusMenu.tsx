import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { MoreVertical, Check, Loader2 } from 'lucide-react';
import type { Task, Pipeline, PipelineStatus, Transition } from '../../../shared/types';

interface TaskStatusMenuProps {
  task: Task;
  pipeline: Pipeline | null;
  onStatusChange: (taskId: string, toStatus: string) => Promise<void>;
}

/** Color dot rendered next to each status label. */
function StatusDot({ color, muted }: { color?: string; muted?: boolean }) {
  const bg = muted
    ? 'bg-muted-foreground/30'
    : color
      ? undefined
      : 'bg-foreground';

  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${bg ?? ''}`}
      style={color && !muted ? { backgroundColor: color } : undefined}
    />
  );
}

export function TaskStatusMenu({ task, pipeline, onStatusChange }: TaskStatusMenuProps) {
  const [open, setOpen] = useState(false);
  const [transitions, setTransitions] = useState<Transition[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Lazy-load transitions when menu opens
  useEffect(() => {
    if (!open) return;
    setLoadError(null);
    setTransitions(null);
    window.api.tasks
      .transitions(task.id)
      .then((t) => setTransitions(t))
      .catch(() => setLoadError('Failed to load statuses'));
  }, [open, task.id]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setOpen((prev) => !prev);
    },
    [],
  );

  const handleTransition = useCallback(
    async (toStatus: string) => {
      if (transitioning) return;
      setTransitioning(toStatus);
      try {
        await onStatusChange(task.id, toStatus);
        setOpen(false);
      } finally {
        setTransitioning(null);
      }
    },
    [onStatusChange, task.id, transitioning],
  );

  const statuses: PipelineStatus[] = pipeline?.statuses ?? [];
  const availableTargets = new Set(transitions?.map((t) => t.to) ?? []);

  return (
    <div className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={handleToggle}
        title="Change status"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </Button>

      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b">
            Change Status
          </div>

          {/* No pipeline */}
          {!pipeline && (
            <div className="px-3 py-3 text-xs text-muted-foreground">
              No statuses available
            </div>
          )}

          {/* Loading */}
          {pipeline && transitions === null && !loadError && (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </div>
          )}

          {/* Error */}
          {loadError && (
            <div className="px-3 py-3 text-xs text-destructive">
              {loadError}
            </div>
          )}

          {/* Status list */}
          {pipeline && transitions !== null && (
            <div className="py-1">
              {statuses.map((s) => {
                const isCurrent = s.name === task.status;
                const isAvailable = availableTargets.has(s.name);
                const isTransitioning = transitioning === s.name;
                const disabled = isCurrent || !isAvailable || transitioning !== null;

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
                    onClick={() => {
                      if (!disabled) handleTransition(s.name);
                    }}
                  >
                    {isTransitioning ? (
                      <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                    ) : (
                      <StatusDot color={s.color} muted={!isCurrent && !isAvailable} />
                    )}
                    <span className="flex-1 truncate">{s.label || s.name}</span>
                    {isCurrent && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
