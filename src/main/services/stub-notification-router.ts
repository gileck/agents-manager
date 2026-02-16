import type { Notification } from '../../shared/types';
import type { INotificationRouter } from '../interfaces/notification-router';

export class StubNotificationRouter implements INotificationRouter {
  sent: Notification[] = [];

  async send(notification: Notification): Promise<void> {
    this.sent.push(notification);
  }
}
