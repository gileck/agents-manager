import type { Notification as AppNotification } from '../../shared/types';
import type { INotificationRouter } from '../interfaces/notification-router';
import { sendNotification, navigateToRoute } from '@template/main/services/notification';
import { showWindow } from '@template/main/core/window';

export class ElectronNotificationRouter implements INotificationRouter {
  async send(notification: AppNotification): Promise<void> {
    sendNotification(notification.title, notification.body, {
      onClick: () => {
        showWindow();
        navigateToRoute(`/agents/${notification.channel}`, 'navigate');
      },
    });
  }
}
