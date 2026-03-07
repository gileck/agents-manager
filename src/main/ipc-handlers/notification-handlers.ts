import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { InAppNotificationFilter } from '../../shared/types';

export function registerNotificationHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.NOTIFICATION_LIST, async (_, filter?: InAppNotificationFilter) => {
    return api.notifications.list(filter);
  });

  registerIpcHandler(IPC_CHANNELS.NOTIFICATION_MARK_READ, async (_, id: string) => {
    return api.notifications.markRead(id);
  });

  registerIpcHandler(IPC_CHANNELS.NOTIFICATION_MARK_ALL_READ, async (_, projectId?: string) => {
    return api.notifications.markAllRead(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.NOTIFICATION_UNREAD_COUNT, async (_, projectId?: string) => {
    return api.notifications.getUnreadCount(projectId);
  });
}
