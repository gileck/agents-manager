import { ipcMain, app } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import { registerIpcHandler, validateId, validateInput } from '@template/main/ipc/ipc-registry';
import * as itemService from './services/item-service';
import { getSetting, setSetting } from '@template/main/services/settings-service';
import type { ItemCreateInput, ItemUpdateInput, AppSettings } from '../shared/types';

export function registerIpcHandlers(): void {
  // ============================================
  // Item Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.ITEM_LIST, async () => {
    return itemService.listItems();
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_GET, async (_, id: string) => {
    validateId(id);
    return itemService.getItem(id);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_CREATE, async (_, input: ItemCreateInput) => {
    validateInput(input, ['name']);
    return itemService.createItem(input);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_UPDATE, async (_, id: string, input: ItemUpdateInput) => {
    validateId(id);
    return itemService.updateItem(id, input);
  });

  registerIpcHandler(IPC_CHANNELS.ITEM_DELETE, async (_, id: string) => {
    validateId(id);
    return itemService.deleteItem(id);
  });

  // ============================================
  // Settings Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.SETTINGS_GET, async (): Promise<AppSettings> => {
    const theme = getSetting('theme', 'system') as 'light' | 'dark' | 'system';
    const notificationsEnabled = getSetting('notifications_enabled', 'true') === 'true';

    return {
      theme,
      notificationsEnabled,
    };
  });

  registerIpcHandler(IPC_CHANNELS.SETTINGS_UPDATE, async (_, updates: Partial<AppSettings>): Promise<AppSettings> => {
    if (updates.theme !== undefined) {
      setSetting('theme', updates.theme);
    }
    if (updates.notificationsEnabled !== undefined) {
      setSetting('notifications_enabled', updates.notificationsEnabled.toString());
    }

    // Return updated settings
    return {
      theme: getSetting('theme', 'system') as 'light' | 'dark' | 'system',
      notificationsEnabled: getSetting('notifications_enabled', 'true') === 'true',
    };
  });

  // ============================================
  // App Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.APP_GET_VERSION, async () => {
    return app.getVersion();
  });
}
