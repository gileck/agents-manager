/**
 * Hook that subscribes to TASK_STATUS_CHANGED WebSocket events and shows
 * Sonner toast notifications with contextual action buttons.
 *
 * Each toast displays the task title (truncated), new status label, and
 * 1-2 action buttons relevant to the new status (View, Review, Approve,
 * Merge, etc.). Clicking the toast body navigates to the task detail page.
 *
 * Must be called inside a React Router context (needs useNavigate).
 */
import React from 'react';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { reportError } from '../lib/error-handler';
import type { Task } from '../../shared/types';
import { TaskStatusToast } from '../components/TaskStatusToast';
import {
  STATUS_TOAST_ACTIONS,
  DEFAULT_TOAST_ACTIONS,
  TOAST_DURATION_MS,
  type ToastActionDescriptor,
} from '../config/task-status-toast-config';

/** Truncate a string to maxLen characters, adding an ellipsis if truncated. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '\u2026';
}

export function useTaskStatusToasts(): void {
  const navigate = useNavigate();

  // Track recently shown toasts to de-duplicate (taskId:status → timestamp)
  const recentRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    /**
     * Execute the action associated with a toast button.
     * Defined inside useEffect to close over the current `navigate`.
     */
    function handleAction(
      action: ToastActionDescriptor,
      taskId: string,
    ): void {
      switch (action.kind) {
      case 'view':
        navigate(`/tasks/${taskId}`);
        break;

      case 'review':
        if (action.tab) {
          navigate(`/tasks/${taskId}/${action.tab}`);
        } else {
          navigate(`/tasks/${taskId}`);
        }
        break;

      case 'approve':
      case 'merge':
        if (action.transitionTo) {
          window.api.tasks
            .transition(taskId, action.transitionTo, 'admin')
            .then((result) => {
              if (result.success) {
                toast.success(`Task transitioned to ${action.transitionTo}`);
              } else {
                toast.error(result.error || 'Transition failed');
              }
            })
            .catch((err: unknown) => reportError(err, 'Task transition'));
        } else {
          navigate(`/tasks/${taskId}`);
        }
        break;

      case 'retry':
        navigate(`/tasks/${taskId}`);
        break;
      }
    }

    const unsubscribe = window.api?.on?.taskStatusChanged?.(
      (taskId: string, task: Task) => {
        // Skip automated/synthetic task IDs
        if (taskId.startsWith('__auto__:')) return;

        // De-duplicate: skip if same taskId+status was toasted in last 2 seconds
        const dedupeKey = `${taskId}:${task.status}`;
        const now = Date.now();
        const lastShown = recentRef.current.get(dedupeKey);
        if (lastShown && now - lastShown < 2000) return;
        recentRef.current.set(dedupeKey, now);

        // Prune old entries (keep map small)
        if (recentRef.current.size > 100) {
          const cutoff = now - 10_000;
          for (const [key, ts] of recentRef.current) {
            if (ts < cutoff) recentRef.current.delete(key);
          }
        }

        const title = truncate(task.title || 'Untitled task', 60);
        const statusLabel = task.status.replace(/_/g, ' ');
        const actions = STATUS_TOAST_ACTIONS[task.status] ?? DEFAULT_TOAST_ACTIONS;

        const primaryAction = actions[0];
        const secondaryAction = actions.length > 1 ? actions[1] : undefined;

        toast.custom(
          (toastId) =>
            React.createElement(TaskStatusToast, {
              toastId,
              title,
              statusLabel,
              onBodyClick: () => {
                navigate(`/tasks/${taskId}`);
                toast.dismiss(toastId);
              },
              primaryAction: primaryAction
                ? { label: primaryAction.label, onClick: () => handleAction(primaryAction, taskId) }
                : undefined,
              secondaryAction: secondaryAction
                ? { label: secondaryAction.label, onClick: () => handleAction(secondaryAction, taskId) }
                : undefined,
            }),
          { duration: TOAST_DURATION_MS },
        );
      },
    );

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);
}
