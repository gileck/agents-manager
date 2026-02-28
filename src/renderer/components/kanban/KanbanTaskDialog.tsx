import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import { MarkdownContent } from '../chat/MarkdownContent';
import { usePipeline } from '../../hooks/usePipelines';
import { getTagColor } from '../../utils/kanban-colors';
import { ExternalLink, Calendar, Maximize2, Minimize2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { reportError } from '../../lib/error-handler';
import type { Task, Transition } from '../../../shared/types';

interface KanbanTaskDialogProps {
  task: Task | null;
  onClose: () => void;
  onTaskMoved?: () => void;
}

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'P0 — Critical', color: '#ef4444' },
  1: { label: 'P1 — High', color: '#f59e0b' },
  2: { label: 'P2 — Medium', color: '#3b82f6' },
  3: { label: 'P3 — Low', color: '#6b7280' },
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function PipelineProgress({ pipeline, currentStatus }: { pipeline: { statuses: { name: string; label: string; color?: string }[] }; currentStatus: string }) {
  const statuses = pipeline.statuses;
  const currentIndex = statuses.findIndex(s => s.name === currentStatus);

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {statuses.map((s, i) => {
        const isPast = i < currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <div key={s.name} className="flex items-center gap-1">
            <div
              title={s.label}
              className="rounded-full transition-all"
              style={{
                width: isCurrent ? '10px' : '8px',
                height: isCurrent ? '10px' : '8px',
                backgroundColor: isCurrent
                  ? (s.color ?? '#3b82f6')
                  : isPast
                    ? '#22c55e'
                    : '#d1d5db',
                boxShadow: isCurrent ? `0 0 0 2px ${(s.color ?? '#3b82f6')}40` : undefined,
              }}
            />
            {i < statuses.length - 1 && (
              <div
                style={{
                  width: '12px',
                  height: '2px',
                  backgroundColor: isPast ? '#22c55e' : '#d1d5db',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function KanbanTaskDialog({ task, onClose, onTaskMoved }: KanbanTaskDialogProps) {
  const navigate = useNavigate();
  const { pipeline } = usePipeline(task?.pipelineId);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  // Fetch valid manual transitions when task changes
  useEffect(() => {
    if (!task) {
      setTransitions([]);
      return;
    }
    let cancelled = false;
    window.api.tasks.transitions(task.id).then((result) => {
      if (!cancelled) setTransitions(result);
    }).catch(() => {
      if (!cancelled) setTransitions([]);
    });
    return () => { cancelled = true; };
  }, [task?.id, task?.status]);

  // Reset full-screen when dialog closes
  useEffect(() => {
    if (!task) setIsFullScreen(false);
  }, [task]);

  const handleTransition = useCallback(async (toStatus: string) => {
    if (!task || transitioning) return;
    setTransitioning(toStatus);
    try {
      const result = await window.api.tasks.transition(task.id, toStatus, 'admin');
      if (result.success) {
        const label = pipeline?.statuses.find(s => s.name === toStatus)?.label ?? toStatus;
        toast.success(`Task moved to ${label}`);
        onTaskMoved?.();
        onClose();
      } else {
        toast.error(result.error || 'Transition failed');
      }
    } catch (error) {
      reportError(error, 'Task transition');
    } finally {
      setTransitioning(null);
    }
  }, [task, transitioning, pipeline, onTaskMoved, onClose]);

  if (!task) return null;

  const priorityInfo = PRIORITY_LABELS[task.priority];

  const handleOpenFull = () => {
    onClose();
    navigate(`/tasks/${task.id}`);
  };

  const dialogStyle: React.CSSProperties = isFullScreen
    ? { maxWidth: '95vw', width: '95vw', maxHeight: '95vh', height: '95vh', display: 'flex', flexDirection: 'column' }
    : { maxWidth: '720px', width: '720px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' };

  return (
    <Dialog open={!!task} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="overflow-hidden" style={dialogStyle}>
        <DialogHeader>
          <div className="flex items-start justify-between gap-2 pr-8">
            <DialogTitle className="text-lg leading-snug">{task.title}</DialogTitle>
            <button
              type="button"
              onClick={() => setIsFullScreen(f => !f)}
              className="shrink-0 rounded-sm opacity-50 hover:opacity-100 transition-opacity"
              title={isFullScreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
          {/* Status + Pipeline + Priority + Assignee row */}
          <div className="flex items-center gap-2 flex-wrap">
            <PipelineBadge status={task.status} pipeline={pipeline} />
            {pipeline && (
              <span className="text-xs text-muted-foreground">{pipeline.name}</span>
            )}
            {priorityInfo && (
              <span
                className="text-xs font-medium px-1.5 py-0.5 rounded"
                style={{ backgroundColor: priorityInfo.color + '20', color: priorityInfo.color }}
              >
                {priorityInfo.label}
              </span>
            )}
            {task.assignee && (
              <span className="text-xs text-muted-foreground ml-auto">
                Assignee: {task.assignee}
              </span>
            )}
          </div>

          {/* Action buttons — available transitions */}
          {transitions.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap rounded-md border px-3 py-2">
              <span className="text-xs text-muted-foreground font-medium mr-1">Actions:</span>
              {transitions.map((t) => {
                const label = t.label || pipeline?.statuses.find(s => s.name === t.to)?.label || t.to;
                return (
                  <Button
                    key={t.to}
                    variant="outline"
                    size="sm"
                    onClick={() => handleTransition(t.to)}
                    disabled={transitioning !== null}
                  >
                    <ArrowRight className="w-3 h-3 mr-1" />
                    {transitioning === t.to ? 'Moving...' : label}
                  </Button>
                );
              })}
            </div>
          )}

          {/* Description — rendered as markdown */}
          {task.description && (
            <div
              className="text-sm rounded-md border p-4 overflow-y-auto"
              style={{ maxHeight: isFullScreen ? 'none' : '280px' }}
            >
              <MarkdownContent content={task.description} />
            </div>
          )}

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {task.tags.map((tag) => {
                const tagColor = getTagColor(tag);
                return (
                  <span
                    key={tag}
                    className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border"
                    style={tagColor.style}
                  >
                    {tag}
                  </span>
                );
              })}
            </div>
          )}

          {/* Pipeline progress */}
          {pipeline && (
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground font-medium">Pipeline Progress</span>
              <PipelineProgress pipeline={pipeline} currentStatus={task.status} />
            </div>
          )}

          {/* Timestamps */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1 border-t">
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              Created {formatDate(task.createdAt)}
            </span>
            {task.updatedAt !== task.createdAt && (
              <span>Updated {formatDate(task.updatedAt)}</span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={handleOpenFull}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
            Open Full Details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
