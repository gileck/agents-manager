import type { Worktree } from '../../shared/types';

export interface IWorktreeManager {
  create(branch: string, taskId: string): Promise<Worktree>;
  get(taskId: string): Promise<Worktree | null>;
  list(): Promise<Worktree[]>;
  lock(taskId: string): Promise<void>;
  unlock(taskId: string): Promise<void>;
  delete(taskId: string): Promise<void>;
  cleanup(): Promise<void>;
}
