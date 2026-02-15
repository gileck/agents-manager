import { IpcMainInvokeEvent } from 'electron';
export type IpcHandler<TArgs extends any[] = any[], TReturn = any> = (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TReturn> | TReturn;
export declare function registerIpcHandler<TArgs extends any[], TReturn>(channel: string, handler: IpcHandler<TArgs, TReturn>): void;
export declare function removeIpcHandler(channel: string): void;
export declare function validateInput(input: any, requiredFields: string[]): void;
export declare function validateId(id: any, fieldName?: string): string;
//# sourceMappingURL=ipc-registry.d.ts.map