export const createChannel = (namespace: string, action: string): string => {
  return `${namespace}:${action}`;
};

export interface IpcResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
