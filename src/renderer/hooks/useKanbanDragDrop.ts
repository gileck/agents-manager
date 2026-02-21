import { useState, useCallback } from 'react';
import { DragStartEvent, DragEndEvent, DragCancelEvent } from '@dnd-kit/core';
import type { Task, KanbanColumn, TransitionResult } from '../../shared/types';
import { toast } from 'sonner';

interface UseKanbanDragDropProps {
  tasks: Task[];
  columns: KanbanColumn[];
  onTaskMove: (taskId: string, newStatus: string) => Promise<TransitionResult>;
}

interface PendingTransition {
  taskId: string;
  fromStatus: string;
  toStatus: string;
  rollback: () => void;
}

export function useKanbanDragDrop({ tasks, columns, onTaskMove }: UseKanbanDragDropProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const task = tasks.find(t => t.id === active.id);
    if (task) {
      setActiveTask(task);
    }
  }, [tasks]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    // Clear active task
    setActiveTask(null);

    if (!over) {
      return;
    }

    const taskId = active.id as string;
    const task = tasks.find(t => t.id === taskId);

    if (!task) {
      return;
    }

    // Get the target column
    const targetColumnId = over.id as string;
    const targetColumn = columns.find(c => c.id === targetColumnId);

    if (!targetColumn) {
      return;
    }

    // Find the first status in the target column
    const newStatus = targetColumn.statuses[0];

    // Check if the status actually changed
    if (newStatus === task.status) {
      return;
    }

    // Store rollback information
    const fromStatus = task.status;
    const rollback = () => {
      // Rollback will be handled by refetching tasks
      toast.error('Failed to move task. Rolling back...');
    };

    setPendingTransition({
      taskId,
      fromStatus,
      toStatus: newStatus,
      rollback,
    });

    try {
      // Attempt the transition
      const result = await onTaskMove(taskId, newStatus);

      if (!result.success) {
        // Transition failed
        rollback();

        // Show error message with details
        let errorMessage = 'Failed to move task';
        if (result.guardFailures && result.guardFailures.length > 0) {
          const guardNames = result.guardFailures.map(f => f.guard).join(', ');
          errorMessage = `Cannot move task: ${guardNames} guard(s) failed`;
        } else if (result.hookFailures && result.hookFailures.length > 0) {
          const hookNames = result.hookFailures.map(f => f.hook).join(', ');
          errorMessage = `Task moved but hook(s) failed: ${hookNames}`;
        } else if (result.error) {
          errorMessage = `Failed to move task: ${result.error}`;
        }
        toast.error(errorMessage);
      } else {
        // Success
        toast.success(`Task moved to ${targetColumn.title}`);
      }
    } catch (error) {
      // Unexpected error
      rollback();
      toast.error('An unexpected error occurred while moving the task');
      console.error('Task transition error:', error);
    } finally {
      setPendingTransition(null);
    }
  }, [tasks, columns, onTaskMove]);

  const handleDragCancel = useCallback((_event: DragCancelEvent) => {
    // Clear active task and any pending transition
    setActiveTask(null);

    if (pendingTransition) {
      pendingTransition.rollback();
      setPendingTransition(null);
    }
  }, [pendingTransition]);

  return {
    activeTask,
    isPending: !!pendingTransition,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
}
