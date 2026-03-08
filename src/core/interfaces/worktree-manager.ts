import type { Worktree } from '../../shared/types';

export interface IWorktreeManager {
  create(branch: string, taskId: string, baseBranch?: string): Promise<Worktree>;
  get(taskId: string): Promise<Worktree | null>;
  list(): Promise<Worktree[]>;
  lock(taskId: string): Promise<void>;
  unlock(taskId: string): Promise<void>;
  delete(taskId: string): Promise<void>;
  cleanup(activeTaskIds?: string[]): Promise<void>;
  /** Ensure node_modules symlink exists in the worktree (restores if missing or replaced). */
  ensureNodeModules(taskId: string): Promise<void>;
}
