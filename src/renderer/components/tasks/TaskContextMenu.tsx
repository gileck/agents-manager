import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Copy, ArrowRightLeft, Trash2, Activity, Loader2, Check } from 'lucide-react';
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

interface ContextMenuState {
  x: number;
  y: number;
  task: Task;
  pipeline: Pipeline | null;
}

interface TaskContextMenuProps {
  children: React.ReactNode;
  task: Task;
  pipeline: Pipeline | null;
  onStatusChange: (taskId: string, toStatus: string) => Promise<void>;
  onDelete: () => void;
  onDuplicate: () => void;
}

/**
 * Wraps a task row/card and provides a right-click context menu with
 * common actions: open in new tab, copy task ID, transition, delete, etc.
 */
export function TaskContextMenu({
  children,
  task,
  pipeline,
  onStatusChange,
  onDelete,
  onDuplicate,
}: TaskContextMenuProps) {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [showTransitions, setShowTransitions] = useState(false);
  const [transitions, setTransitions] = useState<Transition[] | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const viewportPadding = 8;
    const menuWidth = 220;
    const menuHeight = 260;

    let x = e.clientX;
    let y = e.clientY;

    // Adjust if overflows right
    if (x + menuWidth > window.innerWidth - viewportPadding) {
      x = window.innerWidth - menuWidth - viewportPadding;
    }
    // Adjust if overflows bottom
    if (y + menuHeight > window.innerHeight - viewportPadding) {
      y = window.innerHeight - menuHeight - viewportPadding;
    }

    setMenu({ x, y, task, pipeline });
    setShowTransitions(false);
    setTransitions(null);
  }, [task, pipeline]);

  // Close on click outside
  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menu]);

  // Close on Escape
  useEffect(() => {
    if (!menu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [menu]);

  // Load transitions when submenu opened
  useEffect(() => {
    if (!showTransitions || !menu) return;
    setTransitions(null);
    window.api.tasks
      .transitions(menu.task.id)
      .then((r) => setTransitions(r.transitions))
      .catch(() => setTransitions([]));
  }, [showTransitions, menu]);

  const handleTransition = useCallback(async (toStatus: string) => {
    if (!menu || transitioning) return;
    setTransitioning(toStatus);
    try {
      await onStatusChange(menu.task.id, toStatus);
      setMenu(null);
    } finally {
      setTransitioning(null);
    }
  }, [menu, transitioning, onStatusChange]);

  const handleCopyId = useCallback(() => {
    if (!menu) return;
    navigator.clipboard.writeText(menu.task.id);
    setMenu(null);
  }, [menu]);

  const handleOpenNewTab = useCallback(() => {
    if (!menu) return;
    window.open(`/tasks/${menu.task.id}`, '_blank');
    setMenu(null);
  }, [menu]);

  const handleViewRuns = useCallback(() => {
    if (!menu) return;
    window.open(`/tasks/${menu.task.id}?tab=runs`, '_blank');
    setMenu(null);
  }, [menu]);

  const handleDelete = useCallback(() => {
    setMenu(null);
    onDelete();
  }, [onDelete]);

  const handleDuplicate = useCallback(() => {
    setMenu(null);
    onDuplicate();
  }, [onDuplicate]);

  const statuses: PipelineStatus[] = menu?.pipeline?.statuses ?? [];
  const availableTargets = new Set(transitions?.map((t) => t.to) ?? []);

  return (
    <>
      <div onContextMenu={handleContextMenu}>
        {children}
      </div>

      {menu && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[90] min-w-[200px] rounded-md border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 py-1"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Navigation actions */}
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors cursor-pointer"
            onClick={handleOpenNewTab}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            Open in new tab
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors cursor-pointer"
            onClick={handleCopyId}
          >
            <Copy className="h-3.5 w-3.5 shrink-0" />
            Copy task ID
          </button>

          <div className="border-t my-1" />

          {/* Transition submenu */}
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors cursor-pointer"
            onClick={() => setShowTransitions((prev) => !prev)}
          >
            <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">Transition to...</span>
          </button>

          {showTransitions && (
            <div className="border-t border-b my-1 py-1 bg-muted/20">
              {transitions === null ? (
                <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading...
                </div>
              ) : statuses.length === 0 ? (
                <div className="px-3 py-1.5 text-xs text-muted-foreground">No statuses available</div>
              ) : (
                statuses.map((s) => {
                  const isCurrent = s.name === menu.task.status;
                  const isAvailable = availableTargets.has(s.name);
                  const isTransitioning = transitioning === s.name;
                  const disabled = isCurrent || !isAvailable || transitioning !== null;
                  const color = resolveStatusColor(s);

                  return (
                    <button
                      key={s.name}
                      className={`flex items-center gap-2 w-full px-5 py-1 text-sm text-left transition-colors ${
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
                      {isCurrent && <Check className="h-3 w-3 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* More actions */}
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors cursor-pointer"
            onClick={handleViewRuns}
          >
            <Activity className="h-3.5 w-3.5 shrink-0" />
            View runs
          </button>
          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors cursor-pointer"
            onClick={handleDuplicate}
          >
            <Copy className="h-3.5 w-3.5 shrink-0" />
            Duplicate
          </button>

          <div className="border-t my-1" />

          <button
            className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
            onClick={handleDelete}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" />
            Delete
          </button>
        </div>,
        document.body
      )}
    </>
  );
}
