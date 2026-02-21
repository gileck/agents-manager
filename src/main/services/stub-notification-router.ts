import type { Notification } from '../../shared/types';
import type { INotificationRouter } from '../interfaces/notification-router';

export class StubNotificationRouter implements INotificationRouter {
  sent: Array<{ notification: Notification; timestamp: number }> = [];

  async send(notification: Notification): Promise<void> {
    this.sent.push({ notification, timestamp: Date.now() });
  }

  clear(): void {
    this.sent = [];
  }
}
