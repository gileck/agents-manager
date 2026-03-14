import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promisify } from 'util';

// Create a controllable mock for execFile that works with promisify.
// The key insight: promisify(execFile) uses execFile[util.promisify.custom],
// so we must either set that symbol or ensure our mock follows standard callback convention
// where promisify resolves with the FIRST callback arg after err.
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
    // Set the custom promisify to match Node.js execFile behavior
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

const { LocalGitOps } = await import('../../src/core/services/local-git-ops');

describe('LocalGitOps', () => {
  const CWD = '/home/test/worktree';
  let ops: InstanceType<typeof LocalGitOps>;

  beforeEach(() => {
    vi.resetAllMocks();
    execFileHandler = () => '';
    ops = new LocalGitOps(CWD);
  });

  describe('fetch()', () => {
    it('calls git fetch with default remote', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.fetch();

      expect(calls[0]).toEqual(['fetch', 'origin']);
    });

    it('calls git fetch with custom remote', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.fetch('upstream');

      expect(calls[0]).toEqual(['fetch', 'upstream']);
    });
  });

  describe('createBranch()', () => {
    it('creates branch without base', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.createBranch('feature/new');

      expect(calls[0]).toEqual(['checkout', '-b', 'feature/new']);
    });

    it('creates branch with base', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.createBranch('feature/new', 'origin/main');

      expect(calls[0]).toEqual(['checkout', '-b', 'feature/new', 'origin/main']);
    });
  });

  describe('push()', () => {
    it('pushes without force by default', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.push('my-branch');

      expect(calls[0]).toEqual(['push', '-u', 'origin', 'my-branch']);
    });

    it('pushes with --force-with-lease when force=true', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.push('my-branch', true);

      expect(calls[0]).toEqual(['push', '-u', 'origin', 'my-branch', '--force-with-lease']);
    });
  });

  describe('diff()', () => {
    it('runs two-arg diff with toRef', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return 'diff output\n'; };

      const result = await ops.diff('origin/main', 'HEAD');

      expect(calls[0]).toEqual(['diff', 'origin/main...HEAD']);
      expect(result).toBe('diff output');
    });

    it('runs single-arg diff without toRef', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.diff('origin/main');

      expect(calls[0]).toEqual(['diff', 'origin/main']);
    });
  });

  describe('commit()', () => {
    it('stages all files, commits, and returns HEAD hash', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => {
        calls.push(args);
        if (args[0] === 'rev-parse') return 'abc123def\n';
        return '';
      };

      const hash = await ops.commit('fix: something');

      expect(calls[0]).toEqual(['add', '-A']);
      expect(calls[1]).toEqual(['commit', '-m', 'fix: something']);
      expect(calls[2]).toEqual(['rev-parse', 'HEAD']);
      expect(hash).toBe('abc123def');
    });
  });

  describe('log()', () => {
    it('parses git log output into entries', async () => {
      execFileHandler = (_cmd, args) => {
        if (args[0] === 'log') {
          return [
            'abc123', 'fix: first', 'Alice', '2026-01-01T00:00:00Z',
            'def456', 'feat: second', 'Bob', '2026-01-02T00:00:00Z',
          ].join('\n') + '\n';
        }
        return '';
      };

      const entries = await ops.log(2);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        hash: 'abc123',
        subject: 'fix: first',
        author: 'Alice',
        date: '2026-01-01T00:00:00Z',
      });
      expect(entries[1]).toEqual({
        hash: 'def456',
        subject: 'feat: second',
        author: 'Bob',
        date: '2026-01-02T00:00:00Z',
      });
    });

    it('returns empty array for empty output', async () => {
      execFileHandler = () => '';

      const entries = await ops.log();

      expect(entries).toEqual([]);
    });
  });

  describe('rebase()', () => {
    it('calls git rebase with the onto ref', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.rebase('origin/main');

      expect(calls[0]).toEqual(['rebase', 'origin/main']);
    });
  });

  describe('rebaseAbort()', () => {
    it('calls git rebase --abort', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.rebaseAbort();

      expect(calls[0]).toEqual(['rebase', '--abort']);
    });
  });

  describe('getCurrentBranch()', () => {
    it('returns the current branch name', async () => {
      execFileHandler = () => 'task/abc\n';

      const branch = await ops.getCurrentBranch();

      expect(branch).toBe('task/abc');
    });
  });

  describe('clean()', () => {
    it('runs reset --hard then clean -fd', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.clean();

      expect(calls[0]).toEqual(['reset', '--hard', 'HEAD']);
      expect(calls[1]).toEqual(['clean', '-fd']);
    });
  });

  describe('status()', () => {
    it('returns porcelain status output', async () => {
      execFileHandler = () => 'M  src/file.ts\n';

      const result = await ops.status();

      expect(result).toBe('M  src/file.ts');
    });
  });

  describe('deleteRemoteBranch()', () => {
    it('calls git push origin --delete', async () => {
      const calls: string[][] = [];
      execFileHandler = (_cmd, args) => { calls.push(args); return ''; };

      await ops.deleteRemoteBranch('old-branch');

      expect(calls[0]).toEqual(['push', 'origin', '--delete', 'old-branch']);
    });
  });

  describe('getCommitDetail()', () => {
    it('parses commit body and file changes', async () => {
      execFileHandler = (_cmd, args) => {
        if (args[0] === 'log') return 'Detailed commit body\n';
        if (args[0] === 'diff') return 'A\tsrc/new.ts\nM\tsrc/old.ts\n';
        return '';
      };

      const detail = await ops.getCommitDetail('abc123');

      expect(detail.hash).toBe('abc123');
      expect(detail.body).toBe('Detailed commit body');
      expect(detail.files).toEqual([
        { status: 'A', path: 'src/new.ts' },
        { status: 'M', path: 'src/old.ts' },
      ]);
    });
  });
});
