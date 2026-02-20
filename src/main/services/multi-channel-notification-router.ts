import type { INotificationRouter } from '../interfaces/notification-router';
import type { Notification } from '../../shared/types';

export class MultiChannelNotificationRouter implements INotificationRouter {
  private routers: INotificationRouter[] = [];

  addRouter(router: INotificationRouter): void {
    this.routers.push(router);
  }

  removeRouter(router: INotificationRouter): void {
    const idx = this.routers.indexOf(router);
    if (idx !== -1) {
      this.routers.splice(idx, 1);
    }
  }

  async send(notification: Notification): Promise<void> {
    const results = await Promise.allSettled(
      this.routers.map((r) => r.send(notification)),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[notification-router]', r.reason);
      }
    }
  }
}
