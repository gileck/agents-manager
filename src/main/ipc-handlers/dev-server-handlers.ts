import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';

export function registerDevServerHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.DEV_SERVER_START, async (_, taskId: string) => {
    return api.devServers.start(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.DEV_SERVER_STOP, async (_, taskId: string) => {
    return api.devServers.stop(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.DEV_SERVER_STATUS, async (_, taskId: string) => {
    return api.devServers.status(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.DEV_SERVER_LIST, async () => {
    return api.devServers.list();
  });
}
