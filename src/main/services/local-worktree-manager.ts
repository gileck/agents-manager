import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import type { Worktree } from '../../shared/types';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import { getShellEnv } from './shell-env';

const execFileAsync = promisify(execFile);

const WORKTREE_DIR = '.agent-worktrees';

export class LocalWorktreeManager implements IWorktreeManager {
  constructor(private projectPath: string) {}

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.projectPath,
      env: getShellEnv(),
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  }

  private worktreePath(taskId: string): string {
    return join(this.projectPath, WORKTREE_DIR, taskId);
  }

  private ensureGitignore(): void {
    const gitignorePath = join(this.projectPath, '.gitignore');
    const entry = `${WORKTREE_DIR}/`;

    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8');
      if (content.includes(entry)) return;
      appendFileSync(gitignorePath, `\n${entry}\n`);
    } else {
      appendFileSync(gitignorePath, `${entry}\n`);
    }
  }

  async create(branch: string, taskId: string): Promise<Worktree> {
    this.ensureGitignore();

    const wtPath = this.worktreePath(taskId);

    try {
      // Try creating with a new branch
      await this.git(['worktree', 'add', '-b', branch, wtPath]);
    } catch {
      // Branch may already exist from a prior run — retry without -b
      await this.git(['worktree', 'add', wtPath, branch]);
    }

    return { path: wtPath, branch, taskId, locked: false };
  }

  async get(taskId: string): Promise<Worktree | null> {
    const wtPath = this.worktreePath(taskId);
    if (!existsSync(wtPath)) return null;

    const worktrees = await this.parseWorktreeList();
    return worktrees.find((wt) => wt.taskId === taskId) ?? null;
  }

  async list(): Promise<Worktree[]> {
    const worktrees = await this.parseWorktreeList();
    return worktrees.filter((wt) => wt.path.includes(`/${WORKTREE_DIR}/`));
  }

  async lock(taskId: string): Promise<void> {
    try {
      await this.git(['worktree', 'lock', this.worktreePath(taskId)]);
    } catch (err) {
      // Ignore "already locked"
      if (!(err instanceof Error && err.message.includes('already locked'))) throw err;
    }
  }

  async unlock(taskId: string): Promise<void> {
    try {
      await this.git(['worktree', 'unlock', this.worktreePath(taskId)]);
    } catch (err) {
      // Ignore "not locked"
      if (!(err instanceof Error && err.message.includes('not locked'))) throw err;
    }
  }

  async delete(taskId: string): Promise<void> {
    await this.git(['worktree', 'remove', this.worktreePath(taskId), '--force']);
  }

  async cleanup(): Promise<void> {
    await this.git(['worktree', 'prune']);

    const worktrees = await this.parseWorktreeList();
    for (const wt of worktrees) {
      if (wt.path.includes(`/${WORKTREE_DIR}/`) && !wt.locked) {
        try {
          await this.git(['worktree', 'remove', wt.path, '--force']);
        } catch {
          // Best-effort cleanup
        }
      }
    }
  }

  private async parseWorktreeList(): Promise<Worktree[]> {
    const output = await this.git(['worktree', 'list', '--porcelain']);
    if (!output) return [];

    const worktrees: Worktree[] = [];
    const blocks = output.split('\n\n');

    for (const block of blocks) {
      const lines = block.split('\n');
      let path = '';
      let branch = '';
      let locked = false;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          path = line.slice('worktree '.length);
        } else if (line.startsWith('branch ')) {
          // "branch refs/heads/foo" → "foo"
          branch = line.slice('branch '.length).replace('refs/heads/', '');
        } else if (line === 'locked') {
          locked = true;
        }
      }

      if (!path || !path.includes(`/${WORKTREE_DIR}/`)) continue;

      // Extract taskId from path: .../.agent-worktrees/<taskId>
      const segments = path.split('/');
      const wtDirIdx = segments.indexOf(WORKTREE_DIR);
      const taskId = wtDirIdx >= 0 && wtDirIdx + 1 < segments.length
        ? segments[wtDirIdx + 1]
        : '';

      if (taskId) {
        worktrees.push({ path, branch, taskId, locked });
      }
    }

    return worktrees;
  }
}
