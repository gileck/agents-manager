import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';

export function registerTelegramHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_START, async (_, projectId: string) => {
    return api.telegram.start(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_STOP, async (_, projectId: string) => {
    return api.telegram.stop(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_STATUS, async (_, projectId: string) => {
    return api.telegram.getStatus(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_BOT_SESSION, async (_, projectId: string) => {
    return api.telegram.getSession(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.TELEGRAM_TEST, async (_, botToken: string, chatId: string) => {
    return api.telegram.test(botToken, chatId);
  });
}
