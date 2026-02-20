import { IpcMainInvokeEvent } from 'electron';
export type IpcHandler<TArgs extends unknown[] = unknown[], TReturn = unknown> = (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TReturn> | TReturn;
export declare function registerIpcHandler<TArgs extends unknown[], TReturn>(channel: string, handler: IpcHandler<TArgs, TReturn>): void;
export declare function removeIpcHandler(channel: string): void;
export declare function validateInput(input: unknown, requiredFields: string[]): void;
export declare function validateId(id: unknown, fieldName?: string): string;
//# sourceMappingURL=ipc-registry.d.ts.map