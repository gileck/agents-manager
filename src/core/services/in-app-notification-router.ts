import type { INotificationRouter } from '../interfaces/notification-router';
import type { IInAppNotificationStore } from '../interfaces/in-app-notification-store';
import type { Notification } from '../../shared/types';

export class InAppNotificationRouter implements INotificationRouter {
  constructor(
    private store: IInAppNotificationStore,
    private emitWs: (type: string, payload: unknown) => void,
  ) {}

  async send(notification: Notification): Promise<void> {
    const entry = await this.store.add({
      taskId: notification.taskId,
      projectId: notification.projectId,
      title: notification.title,
      body: notification.body,
      navigationUrl: notification.navigationUrl ?? `/tasks/${notification.taskId}`,
    });
    this.emitWs('notification:added', entry);
  }
}
