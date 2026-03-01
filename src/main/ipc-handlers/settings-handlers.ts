import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { AppSettings } from '../../shared/types';

export function registerSettingsHandlers(api: ApiClient): void {
  registerIpcHandler(IPC_CHANNELS.SETTINGS_GET, async () => {
    return api.settings.get();
  });

  registerIpcHandler(IPC_CHANNELS.SETTINGS_UPDATE, async (_, updates: Partial<AppSettings>) => {
    return api.settings.update(updates);
  });
}
