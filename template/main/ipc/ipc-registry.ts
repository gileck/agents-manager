import { ipcMain, IpcMainInvokeEvent } from 'electron';

export type IpcHandler<TArgs extends any[] = any[], TReturn = any> = (
  event: IpcMainInvokeEvent,
  ...args: TArgs
) => Promise<TReturn> | TReturn;

export function registerIpcHandler<TArgs extends any[], TReturn>(
  channel: string,
  handler: IpcHandler<TArgs, TReturn>
): void {
  ipcMain.handle(channel, handler);
}

export function removeIpcHandler(channel: string): void {
  ipcMain.removeHandler(channel);
}

export function validateInput(input: any, requiredFields: string[]): void {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid input: must be an object');
  }
  for (const field of requiredFields) {
    if (!(field in input)) {
      throw new Error(`Invalid input: missing required field '${field}'`);
    }
  }
}

export function validateId(id: any, fieldName: string = 'id'): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(`Invalid ${fieldName}: must be a non-empty string`);
  }
  return id;
}
