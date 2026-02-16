import type { Worktree } from '../../shared/types';
import type { IWorktreeManager } from '../interfaces/worktree-manager';

export class StubWorktreeManager implements IWorktreeManager {
  private worktrees = new Map<string, Worktree>();

  async create(branch: string, taskId: string): Promise<Worktree> {
    const worktree: Worktree = {
      path: `/tmp/worktrees/${taskId}`,
      branch,
      taskId,
      locked: false,
    };
    this.worktrees.set(taskId, worktree);
    return worktree;
  }

  async get(taskId: string): Promise<Worktree | null> {
    return this.worktrees.get(taskId) ?? null;
  }

  async list(): Promise<Worktree[]> {
    return Array.from(this.worktrees.values());
  }

  async lock(taskId: string): Promise<void> {
    const wt = this.worktrees.get(taskId);
    if (wt) wt.locked = true;
  }

  async unlock(taskId: string): Promise<void> {
    const wt = this.worktrees.get(taskId);
    if (wt) wt.locked = false;
  }

  async delete(taskId: string): Promise<void> {
    this.worktrees.delete(taskId);
  }

  async cleanup(): Promise<void> {
    this.worktrees.clear();
  }
}
