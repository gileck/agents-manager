import type { InAppNotification, InAppNotificationCreateInput, InAppNotificationFilter } from '../../shared/types';

export interface IInAppNotificationStore {
  add(input: InAppNotificationCreateInput): Promise<InAppNotification>;
  list(filter?: InAppNotificationFilter): Promise<InAppNotification[]>;
  markRead(id: string): Promise<void>;
  markAllRead(projectId?: string): Promise<void>;
  getUnreadCount(projectId?: string): Promise<number>;
}
