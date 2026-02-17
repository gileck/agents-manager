import type { Notification } from '../../shared/types';
import type { INotificationRouter } from '../interfaces/notification-router';
import { sendNotification } from '@template/main/services/notification';
import { showWindow, sendToRenderer } from '@template/main/core/window';
import { IPC_CHANNELS } from '../../shared/ipc-channels';

export class DesktopNotificationRouter implements INotificationRouter {
  async send(notification: Notification): Promise<void> {
    sendNotification(notification.title, notification.body, {
      onClick: () => {
        showWindow();
        sendToRenderer(IPC_CHANNELS.NAVIGATE, `/tasks/${notification.taskId}`);
      },
    });
  }
}
