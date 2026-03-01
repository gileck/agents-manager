import type { Notification } from '../../shared/types';

export interface INotificationRouter {
  send(notification: Notification): Promise<void>;
}
