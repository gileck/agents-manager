import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import type { BadgeProps } from '../ui/badge';
import { GitPullRequest, CheckSquare, User } from 'lucide-react';
import { TaskItemMenu } from '../tasks/TaskItemMenu';
import { formatRelativeTimestamp } from '../tasks/task-helpers';
import type { Task, Pipeline } from '../../../shared/types';
import type { PipelineMap } from '../../pages/KanbanPage';

const PRIORITY_VARIANTS: Record<number, NonNullable<BadgeProps['variant']>> = {
  0: 'destructive',
  1: 'warning',
  2: 'default',
  3: 'success',
};

interface KanbanCardProps {
  task: Task;
  pipeline: Pipeline;
  pipelineMap?: PipelineMap;
  onStatusChange: (taskId: string, newStatus: string) => Promise<void>;
}

export function KanbanCard({
  task,
  pipeline,
  pipelineMap: _pipelineMap,
  onStatusChange,
}: KanbanCardProps) {
  const navigate = useNavigate();

  // Set up sortable for drag and drop
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const handleClick = () => {
    navigate(`/tasks/${task.id}`);
  };

  const handleDuplicate = async () => {
    try {
      await window.api.tasks.create({
        projectId: task.projectId,
        pipelineId: task.pipelineId,
        title: `${task.title} (copy)`,
        description: task.description ?? undefined,
        priority: task.priority,
        featureId: task.featureId ?? undefined,
        tags: task.tags,
        assignee: task.assignee ?? undefined,
      });
      // Parent component will refetch
    } catch (err) {
      console.error('Failed to duplicate task:', err);
    }
  };

  const handleDelete = async () => {
    try {
      await window.api.tasks.delete(task.id);
      // Parent component will refetch
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-pointer hover:bg-accent/50 transition-colors group touch-none"
      onClick={handleClick}
    >
      <CardContent className="p-3">
        {/* Priority and Menu */}
        <div className="flex items-start justify-between mb-2">
          <Badge variant={PRIORITY_VARIANTS[task.priority] ?? 'outline'} className="text-xs">
            P{task.priority}
          </Badge>
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <TaskItemMenu
              task={task}
              pipeline={pipeline}
              onStatusChange={onStatusChange}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />
          </div>
        </div>

        {/* Title */}
        <h4 className="font-medium text-sm mb-1 line-clamp-2">
          {task.title}
        </h4>

        {/* Tags */}
        {task.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {task.tags.slice(0, 2).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tag}
              </Badge>
            ))}
            {task.tags.length > 2 && (
              <span className="text-[10px] text-muted-foreground">
                +{task.tags.length - 2}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {/* Subtasks */}
            {task.subtasks.length > 0 && (
              <div className="flex items-center gap-1" title="Subtask progress">
                <CheckSquare className="h-3 w-3" />
                <span>
                  {task.subtasks.filter((s) => s.status === 'done').length}/{task.subtasks.length}
                </span>
              </div>
            )}

            {/* PR Link */}
            {task.prLink && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  window.api.shell.openInChrome(task.prLink!);
                }}
                title="Open PR"
                className="hover:text-blue-500 transition-colors"
              >
                <GitPullRequest className="h-3 w-3" />
              </button>
            )}

            {/* Assignee */}
            {task.assignee && (
              <div className="flex items-center gap-1" title={`Assigned to ${task.assignee}`}>
                <User className="h-3 w-3" />
                <span className="truncate max-w-[60px]">{task.assignee}</span>
              </div>
            )}
          </div>

          {/* Updated time */}
          <span title={new Date(task.updatedAt).toLocaleString()}>
            {formatRelativeTimestamp(task.updatedAt)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}