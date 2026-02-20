import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export function createInvokeHandler<TArgs extends unknown[], TReturn>(
  channel: string
) {
  return (...args: TArgs): Promise<TReturn> => ipcRenderer.invoke(channel, ...args);
}

export function createEventListener<TData>(channel: string) {
  return (callback: (data: TData) => void) => {
    const listener = (_: IpcRendererEvent, data: TData) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

export function exposeBridge<T extends object>(apiName: string, api: T): void {
  contextBridge.exposeInMainWorld(apiName, api);
}
