import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { ITaskStore } from '../interfaces/task-store';
import type { Task, Transition, TransitionContext, HookResult, NotificationAction } from '../../shared/types';
import { getAppLogger } from '../services/app-logger';

function getActionsForStatus(task: Task, toStatus: string): NotificationAction[] {
  const viewAction: NotificationAction = { label: '\u{1F441}\u{FE0F} View', callbackData: `v|${task.id}` };

  switch (toStatus) {
    case 'plan_review':
      return [
        viewAction,
        { label: '\u{2705} Approve & Implement', callbackData: `t|${task.id}|implementing` },
        { label: '\u{1F504} Request Changes', callbackData: `t|${task.id}|planning` },
      ];
    case 'design_review':
      return [
        viewAction,
        { label: '\u{2705} Approve & Plan', callbackData: `t|${task.id}|planning` },
        { label: '\u{2705} Approve & Implement', callbackData: `t|${task.id}|implementing` },
        { label: '\u{1F504} Request Changes', callbackData: `t|${task.id}|designing` },
      ];
    case 'investigation_review':
      return [
        viewAction,
        { label: '\u{2705} Approve & Implement', callbackData: `t|${task.id}|implementing` },
        { label: '\u{1F3A8} Start Design', callbackData: `t|${task.id}|designing` },
        { label: '\u{1F504} Request Changes', callbackData: `t|${task.id}|investigating` },
      ];
    case 'pr_review': {
      const actions: NotificationAction[] = [];
      if (task.prLink) {
        actions.push({ label: '\u{1F517} View PR', url: task.prLink });
      }
      actions.push(
        { label: '\u{2705} Approve', callbackData: `t|${task.id}|ready_to_merge` },
        { label: '\u{1F504} Request Changes', callbackData: `t|${task.id}|implementing` },
      );
      return actions;
    }
    case 'ready_to_merge': {
      const actions: NotificationAction[] = [];
      if (task.prLink) {
        actions.push({ label: '\u{1F517} View PR', url: task.prLink });
      }
      actions.push(
        { label: '\u{1F500} Merge', callbackData: `t|${task.id}|done` },
        { label: '\u{1F504} Request Changes', callbackData: `t|${task.id}|implementing` },
      );
      return actions;
    }
    case 'needs_info':
      return [viewAction];
    default:
      return [viewAction];
  }
}

function getNavigationUrlForStatus(taskId: string, toStatus: string): string {
  switch (toStatus) {
    case 'plan_review':          return `/tasks/${taskId}/plan`;
    case 'design_review':        return `/tasks/${taskId}/design`;
    default:                     return `/tasks/${taskId}`;
  }
}

export function registerNotificationHandler(
  engine: IPipelineEngine,
  deps: { notificationRouter: INotificationRouter; taskStore: ITaskStore },
): void {
  engine.registerHook('notify', async (task: Task, transition: Transition, context: TransitionContext, params?: Record<string, unknown>): Promise<HookResult> => {
    const titleTemplate = (params?.titleTemplate as string) ?? 'Task update';
    const bodyTemplate = (params?.bodyTemplate as string) ?? '{taskTitle}: {fromStatus} → {toStatus}';

    const replacements: Record<string, string> = {
      '{taskTitle}': task.title,
      '{fromStatus}': transition.from,
      '{toStatus}': transition.to,
      '{summary}': (context.data?.summary as string) ?? '',
    };

    const applyTemplate = (template: string): string => {
      let result = template;
      for (const [key, value] of Object.entries(replacements)) {
        result = result.replaceAll(key, value);
      }
      return result;
    };

    // Re-read the task to get fresh data (e.g., prLink set by push_and_create_pr hook).
    // Wrapped in try-catch so a transient DB error doesn't kill the notification.
    let effectiveTask = task;
    try {
      const freshTask = await deps.taskStore.getTask(task.id);
      if (freshTask) {
        effectiveTask = freshTask;
      } else {
        getAppLogger().warn('notification-handler', `Task ${task.id} not found on re-read during transition to ${transition.to}. Using stale task data.`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      getAppLogger().warn('notification-handler', `Failed to re-read task ${task.id}: ${errMsg}. Using stale task data.`);
    }
    const actions = getActionsForStatus(effectiveTask, transition.to);
    const navigationUrl = getNavigationUrlForStatus(task.id, transition.to);

    await deps.notificationRouter.send({
      taskId: task.id,
      title: applyTemplate(titleTemplate),
      body: applyTemplate(bodyTemplate),
      channel: 'pipeline',
      navigationUrl,
      actions,
    });

    return { success: true };
  });
}
