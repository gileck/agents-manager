import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promisify } from 'util';
import * as fs from 'fs';

vi.mock('fs');

const mockedFs = vi.mocked(fs);

// Create a controllable mock for execFile that works with promisify.
let execFileHandler: (cmd: string, args: string[]) => string = () => '';

const mockExecFile = Object.assign(
  function (cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) {
    try {
      const stdout = execFileHandler(cmd, args);
      cb(null, { stdout, stderr: '' });
    } catch (err) {
      cb(err as Error, { stdout: '', stderr: (err as Error).message });
    }
  },
  {
    [promisify.custom]: function (cmd: string, args: string[], opts: unknown) {
      return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        mockExecFile(cmd, args, opts, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    },
  }
);

vi.mock('child_process', () => ({
  execFile: mockExecFile,
}));
vi.mock('../../src/core/services/shell-env', () => ({
  getShellEnv: () => ({ PATH: '/usr/bin', HOME: '/home/test' }),
}));

const { LocalWorktreeManager } = await import('../../src/core/services/local-worktree-manager');

describe('LocalWorktreeManager', () => {
  const PROJECT_PATH = '/home/test/my-project';
  let manager: InstanceType<typeof LocalWorktreeManager>;

  beforeEach(() => {
    vi.resetAllMocks();
    execFileHandler = () => '';
    manager = new LocalWorktreeManager(PROJECT_PATH);

    // Default: ensureGitignore sees existing .gitignore with entry already present
    mockedFs.openSync.mockReturnValue(42);
    mockedFs.readFileSync.mockReturnValue('.agent-worktrees/\n' as never);
    mockedFs.closeSync.mockReturnValue(undefined);
  });

  describe('create()', () => {
    it('runs fetch then worktree add -b, and symlinks node_modules', async () => {
      const gitCalls: string[][] = [];
      execFileHandler = (cmd, args) => {
        if (cmd === 'git') gitCalls.push(args);
        return '';
      };
      mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
        const path = p.toString();
        if (path.endsWith('node_modules') && path.includes('.agent-worktrees')) return false;
        if (path.endsWith('node_modules')) return true;
        return true;
      });
      mockedFs.symlinkSync.mockReturnValue(undefined);

      const result = await manager.create('task/abc', 'abc');

      expect(result.path).toBe(`${PROJECT_PATH}/.agent-worktrees/abc`);
      expect(result.branch).toBe('task/abc');
      expect(result.taskId).toBe('abc');
      expect(result.locked).toBe(false);

      expect(gitCalls[0]).toEqual(['fetch', 'origin']);
      expect(gitCalls[1]).toEqual([
        'worktree', 'add', '-b', 'task/abc',
        `${PROJECT_PATH}/.agent-worktrees/abc`, 'origin/main',
      ]);
    });

    it('deletes conflicting ref and retries when "cannot lock ref" error occurs', async () => {
      const gitCalls: string[][] = [];
      let firstAttempt = true;
      execFileHandler = (_cmd, args) => {
        gitCalls.push(args);
        if (args[0] === 'worktree' && args[1] === 'add' && args[2] === '-b') {
          if (firstAttempt) {
            firstAttempt = false;
            throw new Error(
              "fatal: cannot lock ref 'refs/heads/task/abc/phase-1': " +
              "'refs/heads/task/abc' exists; cannot create 'refs/heads/task/abc/phase-1'"
            );
          }
        }
        return '';
      };
      mockedFs.existsSync.mockReturnValue(false);

      const result = await manager.create('task/abc/phase-1', 'abc');

      expect(firstAttempt).toBe(false);
      expect(result.branch).toBe('task/abc/phase-1');
      // Verify it deleted the conflicting ref
      const branchDeleteCall = gitCalls.find(c => c[0] === 'branch' && c[1] === '-D');
      expect(branchDeleteCall).toEqual(['branch', '-D', 'task/abc']);
    });

    it('retries without -b when branch already exists', async () => {
      let firstAttempt = true;
      execFileHandler = (_cmd, args) => {
        if (args[0] === 'worktree' && args[1] === 'add' && args[2] === '-b') {
          if (firstAttempt) {
            firstAttempt = false;
            throw new Error('fatal: branch already exists');
          }
        }
        return '';
      };
      mockedFs.existsSync.mockReturnValue(false);

      const result = await manager.create('task/abc', 'abc');

      expect(firstAttempt).toBe(false);
      expect(result.branch).toBe('task/abc');
    });
  });

  describe('get()', () => {
    it('returns null when path does not exist', async () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = await manager.get('nonexistent');

      expect(result).toBeNull();
    });

    it('returns worktree when found in list', async () => {
      mockedFs.existsSync.mockReturnValue(true);
      execFileHandler = (_cmd, args) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return [
            `worktree ${PROJECT_PATH}/.agent-worktrees/task1`,
            'branch refs/heads/task/task1/implement',
            '',
          ].join('\n');
        }
        return '';
      };

      const result = await manager.get('task1');

      expect(result).not.toBeNull();
      expect(result!.taskId).toBe('task1');
      expect(result!.branch).toBe('task/task1/implement');
      expect(result!.locked).toBe(false);
    });
  });

  describe('list()', () => {
    it('filters to only agent worktrees', async () => {
      execFileHandler = (_cmd, args) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return [
            `worktree ${PROJECT_PATH}`,
            'branch refs/heads/main',
            '',
            `worktree ${PROJECT_PATH}/.agent-worktrees/task1`,
            'branch refs/heads/task/task1/implement',
            '',
            `worktree ${PROJECT_PATH}/.agent-worktrees/task2`,
            'branch refs/heads/task/task2/implement',
            'locked',
          ].join('\n');
        }
        return '';
      };

      const result = await manager.list();

      expect(result).toHaveLength(2);
      expect(result[0].taskId).toBe('task1');
      expect(result[0].locked).toBe(false);
      expect(result[1].taskId).toBe('task2');
      expect(result[1].locked).toBe(true);
    });
  });

  describe('lock()', () => {
    it('calls git worktree lock', async () => {
      const gitCalls: string[][] = [];
      execFileHandler = (_cmd, args) => {
        gitCalls.push(args);
        return '';
      };

      await manager.lock('task1');

      expect(gitCalls[0]).toEqual([
        'worktree', 'lock', `${PROJECT_PATH}/.agent-worktrees/task1`,
      ]);
    });

    it('tolerates "already locked" errors', async () => {
      execFileHandler = () => {
        throw new Error('fatal: already locked');
      };

      await expect(manager.lock('task1')).resolves.toBeUndefined();
    });

    it('rethrows non-idempotency errors', async () => {
      execFileHandler = () => {
        throw new Error('fatal: unexpected error');
      };

      await expect(manager.lock('task1')).rejects.toThrow('unexpected error');
    });
  });

  describe('unlock()', () => {
    it('tolerates "not locked" errors', async () => {
      execFileHandler = () => {
        throw new Error('fatal: not locked');
      };

      await expect(manager.unlock('task1')).resolves.toBeUndefined();
    });

    it('rethrows non-idempotency errors', async () => {
      execFileHandler = () => {
        throw new Error('fatal: unexpected error');
      };

      await expect(manager.unlock('task1')).rejects.toThrow('unexpected error');
    });
  });

  describe('delete()', () => {
    it('calls git worktree remove --force', async () => {
      const gitCalls: string[][] = [];
      execFileHandler = (_cmd, args) => {
        gitCalls.push(args);
        return '';
      };

      await manager.delete('task1');

      expect(gitCalls[0]).toEqual([
        'worktree', 'remove', `${PROJECT_PATH}/.agent-worktrees/task1`, '--force',
      ]);
    });

    it('tolerates "is not a working tree" errors', async () => {
      execFileHandler = () => {
        throw new Error("fatal: '/path' is not a working tree");
      };

      await expect(manager.delete('task1')).resolves.toBeUndefined();
    });

    it('tolerates "does not exist" errors', async () => {
      execFileHandler = () => {
        throw new Error("fatal: '/path' does not exist");
      };

      await expect(manager.delete('task1')).resolves.toBeUndefined();
    });

    it('rethrows other errors', async () => {
      execFileHandler = () => {
        throw new Error('fatal: permission denied');
      };

      await expect(manager.delete('task1')).rejects.toThrow('permission denied');
    });
  });

  describe('cleanup()', () => {
    function setupWorktreeList(worktrees: Array<{ taskId: string; locked: boolean }>) {
      const blocks = worktrees.map((wt) => {
        const lines = [
          `worktree ${PROJECT_PATH}/.agent-worktrees/${wt.taskId}`,
          `branch refs/heads/task/${wt.taskId}/implement`,
        ];
        if (wt.locked) lines.push('locked');
        return lines.join('\n');
      });
      return blocks.join('\n\n');
    }

    it('prunes and removes unlocked worktrees', async () => {
      const removedPaths: string[] = [];
      execFileHandler = (_cmd, args) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return setupWorktreeList([
            { taskId: 'active', locked: true },
            { taskId: 'stale', locked: false },
          ]);
        }
        if (args[0] === 'worktree' && args[1] === 'remove') {
          removedPaths.push(args[2]);
        }
        return '';
      };

      await manager.cleanup();

      expect(removedPaths).toEqual([`${PROJECT_PATH}/.agent-worktrees/stale`]);
    });

    it('skips worktrees for active task IDs', async () => {
      const removedPaths: string[] = [];
      execFileHandler = (_cmd, args) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return setupWorktreeList([
            { taskId: 'active', locked: false },
            { taskId: 'stale', locked: false },
          ]);
        }
        if (args[0] === 'worktree' && args[1] === 'remove') {
          removedPaths.push(args[2]);
        }
        return '';
      };

      await manager.cleanup(['active']);

      expect(removedPaths).toEqual([`${PROJECT_PATH}/.agent-worktrees/stale`]);
    });

    it('removes all unlocked when no activeTaskIds provided', async () => {
      const removedPaths: string[] = [];
      execFileHandler = (_cmd, args) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return setupWorktreeList([
            { taskId: 'a', locked: false },
            { taskId: 'b', locked: false },
          ]);
        }
        if (args[0] === 'worktree' && args[1] === 'remove') {
          removedPaths.push(args[2]);
        }
        return '';
      };

      await manager.cleanup();

      expect(removedPaths).toHaveLength(2);
    });
  });
});
