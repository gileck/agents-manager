import type { DevServerInfo } from '../../shared/types';

export interface IDevServerManager {
  start(taskId: string, projectId: string, worktreePath: string, command: string): Promise<DevServerInfo>;
  stop(taskId: string): Promise<void>;
  stopAll(): Promise<void>;
  getStatus(taskId: string): DevServerInfo | null;
  list(): DevServerInfo[];
}
