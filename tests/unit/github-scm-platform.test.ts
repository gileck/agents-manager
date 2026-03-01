import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promisify } from 'util';

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

const { GitHubScmPlatform } = await import('../../src/core/services/github-scm-platform');

describe('GitHubScmPlatform', () => {
  const REPO_PATH = '/home/test/repo';
  let platform: InstanceType<typeof GitHubScmPlatform>;

  beforeEach(() => {
    vi.resetAllMocks();
    execFileHandler = () => '';
    platform = new GitHubScmPlatform(REPO_PATH);
  });

  describe('createPR()', () => {
    it('calls gh pr create and parses the returned URL', async () => {
      const ghCalls: string[][] = [];
      execFileHandler = (_cmd, args) => {
        ghCalls.push(args);
        return 'https://github.com/owner/repo/pull/42\n';
      };

      const result = await platform.createPR({
        title: 'My PR',
        body: 'Description',
        head: 'feature-branch',
        base: 'main',
      });

      expect(ghCalls[0]).toEqual([
        'pr', 'create',
        '--title', 'My PR',
        '--body', 'Description',
        '--head', 'feature-branch',
        '--base', 'main',
      ]);
      expect(result.url).toBe('https://github.com/owner/repo/pull/42');
      expect(result.number).toBe(42);
      expect(result.title).toBe('My PR');
    });
  });

  describe('mergePR()', () => {
    it('extracts PR number from URL and merges with squash', async () => {
      const ghCalls: string[][] = [];
      execFileHandler = (_cmd, args) => { ghCalls.push(args); return ''; };

      await platform.mergePR('https://github.com/owner/repo/pull/99');

      expect(ghCalls[0]).toEqual(['pr', 'merge', '99', '--squash', '--delete-branch']);
    });
  });

  describe('isPRMergeable()', () => {
    it('returns true when mergeable is MERGEABLE', async () => {
      execFileHandler = () => JSON.stringify({ mergeable: 'MERGEABLE', state: 'OPEN' });

      const result = await platform.isPRMergeable('https://github.com/owner/repo/pull/1');

      expect(result).toBe(true);
    });

    it('returns false when mergeable is CONFLICTING', async () => {
      execFileHandler = () => JSON.stringify({ mergeable: 'CONFLICTING', state: 'OPEN' });

      const result = await platform.isPRMergeable('https://github.com/owner/repo/pull/1');

      expect(result).toBe(false);
    });

    it('retries when mergeable is UNKNOWN and returns result on resolution', async () => {
      let attempt = 0;
      execFileHandler = () => {
        attempt++;
        if (attempt < 3) return JSON.stringify({ mergeable: 'UNKNOWN', state: 'OPEN' });
        return JSON.stringify({ mergeable: 'MERGEABLE', state: 'OPEN' });
      };

      vi.useFakeTimers();

      const promise = platform.isPRMergeable('https://github.com/owner/repo/pull/5');

      // Advance through the delay timers
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(10_000);

      const result = await promise;

      expect(result).toBe(true);
      expect(attempt).toBe(3);

      vi.useRealTimers();
    });

    it('returns false after all retries exhausted', async () => {
      execFileHandler = () => JSON.stringify({ mergeable: 'UNKNOWN', state: 'OPEN' });

      vi.useFakeTimers();

      const promise = platform.isPRMergeable('https://github.com/owner/repo/pull/5');

      // Advance through all 9 inter-attempt delays
      for (let i = 0; i < 9; i++) {
        await vi.advanceTimersByTimeAsync(10_000);
      }

      const result = await promise;

      expect(result).toBe(false);

      vi.useRealTimers();
    });

    it('logs progress during polling', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      execFileHandler = () => JSON.stringify({ mergeable: 'MERGEABLE', state: 'OPEN' });

      await platform.isPRMergeable('https://github.com/owner/repo/pull/7');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('isPRMergeable: PR #7 attempt 1/10')
      );

      consoleSpy.mockRestore();
    });

    it('returns true immediately when PR is already merged', async () => {
      const ghCalls: string[][] = [];
      execFileHandler = (_cmd, args) => {
        ghCalls.push(args);
        return JSON.stringify({ mergeable: 'UNKNOWN', state: 'MERGED' });
      };

      const result = await platform.isPRMergeable('https://github.com/owner/repo/pull/22');

      expect(result).toBe(true);
      // Should short-circuit on first attempt — no retries
      expect(ghCalls).toHaveLength(1);
    });

    it('returns false immediately when PR is closed', async () => {
      const ghCalls: string[][] = [];
      execFileHandler = (_cmd, args) => {
        ghCalls.push(args);
        return JSON.stringify({ mergeable: 'UNKNOWN', state: 'CLOSED' });
      };

      const result = await platform.isPRMergeable('https://github.com/owner/repo/pull/22');

      expect(result).toBe(false);
      // Should short-circuit on first attempt — no retries
      expect(ghCalls).toHaveLength(1);
    });

    it('fetches both mergeable and state fields', async () => {
      const ghCalls: string[][] = [];
      execFileHandler = (_cmd, args) => {
        ghCalls.push(args);
        return JSON.stringify({ mergeable: 'MERGEABLE', state: 'OPEN' });
      };

      await platform.isPRMergeable('https://github.com/owner/repo/pull/1');

      expect(ghCalls[0]).toContain('mergeable,state');
    });
  });

  describe('getPRStatus()', () => {
    it('returns "merged" for MERGED state', async () => {
      execFileHandler = () => JSON.stringify({ state: 'MERGED' });

      const result = await platform.getPRStatus('https://github.com/owner/repo/pull/10');

      expect(result).toBe('merged');
    });

    it('returns "closed" for CLOSED state', async () => {
      execFileHandler = () => JSON.stringify({ state: 'CLOSED' });

      const result = await platform.getPRStatus('https://github.com/owner/repo/pull/10');

      expect(result).toBe('closed');
    });

    it('returns "open" for OPEN state', async () => {
      execFileHandler = () => JSON.stringify({ state: 'OPEN' });

      const result = await platform.getPRStatus('https://github.com/owner/repo/pull/10');

      expect(result).toBe('open');
    });
  });

  describe('extractPRNumber (via public methods)', () => {
    it('handles numeric string input', async () => {
      const ghCalls: string[][] = [];
      execFileHandler = (_cmd, args) => {
        ghCalls.push(args);
        return JSON.stringify({ state: 'OPEN' });
      };

      await platform.getPRStatus('42');

      expect(ghCalls[0]).toContain('42');
    });

    it('throws for non-PR URL', async () => {
      execFileHandler = () => '';

      await expect(platform.getPRStatus('https://github.com/owner/repo/issues/1'))
        .rejects.toThrow('Cannot extract PR number from URL');
    });
  });
});
