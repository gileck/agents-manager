import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { PipelineBadge } from '../pipeline/PipelineBadge';
import { usePipeline } from '../../hooks/usePipelines';
import { getTagColor } from '../../utils/kanban-colors';
import { ExternalLink, Calendar } from 'lucide-react';
import type { Task } from '../../../shared/types';

interface KanbanTaskDialogProps {
  task: Task | null;
  onClose: () => void;
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
    <div className="flex items-center gap-1">
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

export function KanbanTaskDialog({ task, onClose }: KanbanTaskDialogProps) {
  const navigate = useNavigate();
  const { pipeline } = usePipeline(task?.pipelineId);

  if (!task) return null;

  const priorityInfo = PRIORITY_LABELS[task.priority];

  const handleOpenFull = () => {
    onClose();
    navigate(`/tasks/${task.id}`);
  };

  return (
    <Dialog open={!!task} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent style={{ maxWidth: '540px' }}>
        <DialogHeader>
          <DialogTitle className="text-base leading-snug pr-6">{task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
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

          {/* Description */}
          {task.description && (
            <div
              className="text-sm text-muted-foreground bg-muted/50 rounded-md p-3 overflow-y-auto"
              style={{ maxHeight: '160px' }}
            >
              {task.description}
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
