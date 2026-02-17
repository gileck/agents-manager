import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { Task, Transition } from '../../shared/types';

export function registerNotificationHandler(
  engine: IPipelineEngine,
  deps: { notificationRouter: INotificationRouter },
): void {
  engine.registerHook('notify', async (task: Task, transition: Transition) => {
    const hookDef = transition.hooks?.find((h) => h.name === 'notify');
    const params = hookDef?.params ?? {};

    const titleTemplate = (params.titleTemplate as string) ?? 'Task update';
    const bodyTemplate = (params.bodyTemplate as string) ?? '{taskTitle}: {fromStatus} → {toStatus}';

    const replacements: Record<string, string> = {
      '{taskTitle}': task.title,
      '{fromStatus}': transition.from,
      '{toStatus}': transition.to,
    };

    const applyTemplate = (template: string): string => {
      let result = template;
      for (const [key, value] of Object.entries(replacements)) {
        result = result.replaceAll(key, value);
      }
      return result;
    };

    await deps.notificationRouter.send({
      taskId: task.id,
      title: applyTemplate(titleTemplate),
      body: applyTemplate(bodyTemplate),
      channel: 'desktop',
    });
  });
}
