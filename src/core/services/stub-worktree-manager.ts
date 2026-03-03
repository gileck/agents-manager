import type { Worktree } from '../../shared/types';
import type { IWorktreeManager } from '../interfaces/worktree-manager';

export class StubWorktreeManager implements IWorktreeManager {
  private worktrees = new Map<string, Worktree>();
  private createFailure: Error | null = null;

  setCreateFailure(err: Error): void {
    this.createFailure = err;
  }

  clearCreateFailure(): void {
    this.createFailure = null;
  }

  async create(branch: string, taskId: string): Promise<Worktree> {
    if (this.createFailure) throw this.createFailure;
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

  async ensureNodeModules(_taskId: string): Promise<void> {
    // No-op in stub
  }

  async cleanup(activeTaskIds?: string[]): Promise<void> {
    if (activeTaskIds) {
      const activeSet = new Set(activeTaskIds);
      for (const [taskId, wt] of this.worktrees) {
        if (!wt.locked && !activeSet.has(taskId)) {
          this.worktrees.delete(taskId);
        }
      }
    } else {
      // Remove all unlocked worktrees (original behavior)
      for (const [taskId, wt] of this.worktrees) {
        if (!wt.locked) {
          this.worktrees.delete(taskId);
        }
      }
    }
  }
}
