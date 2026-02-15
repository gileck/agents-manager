// IPC channel names for type-safe communication

export const IPC_CHANNELS = {
  // Item operations
  ITEM_LIST: 'item:list',
  ITEM_GET: 'item:get',
  ITEM_CREATE: 'item:create',
  ITEM_UPDATE: 'item:update',
  ITEM_DELETE: 'item:delete',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // App
  APP_GET_VERSION: 'app:get-version',

  // Navigation (main -> renderer)
  NAVIGATE: 'navigate',
} as const;
