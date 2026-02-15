export declare const createChannel: (namespace: string, action: string) => string;
export interface IpcResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}
//# sourceMappingURL=ipc-base.d.ts.map