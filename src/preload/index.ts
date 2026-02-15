import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { Item, ItemCreateInput, ItemUpdateInput, AppSettings } from '../shared/types';

const IPC_CHANNELS = {
  ITEM_LIST: 'item:list',
  ITEM_GET: 'item:get',
  ITEM_CREATE: 'item:create',
  ITEM_UPDATE: 'item:update',
  ITEM_DELETE: 'item:delete',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  APP_GET_VERSION: 'app:get-version',
  NAVIGATE: 'navigate',
} as const;

// Define the API that will be exposed to the renderer
const api = {
  // Item operations
  items: {
    list: (): Promise<Item[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_LIST),
    get: (id: string): Promise<Item | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_GET, id),
    create: (input: ItemCreateInput): Promise<Item> =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_CREATE, input),
    update: (id: string, input: ItemUpdateInput): Promise<Item | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_UPDATE, id, input),
    delete: (id: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC_CHANNELS.ITEM_DELETE, id),
  },

  // Settings operations
  settings: {
    get: (): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    update: (updates: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, updates),
  },

  // App operations
  app: {
    getVersion: (): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION),
  },

  // Event listeners (main -> renderer)
  on: {
    navigate: (callback: (path: string) => void) => {
      const listener = (_: IpcRendererEvent, path: string) => callback(path);
      ipcRenderer.on(IPC_CHANNELS.NAVIGATE, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.NAVIGATE, listener);
    },
  },
};

// Expose the API to the renderer
contextBridge.exposeInMainWorld('api', api);

// Type declaration for the renderer
export type ElectronAPI = typeof api;
