import { describe, it, expect } from 'vitest';
import { StubGitOps } from '../../src/core/services/stub-git-ops';

describe('Git ref hierarchy conflict detection', () => {
  describe('StubGitOps.refExists()', () => {
    it('returns true when branch exists in the branches array', async () => {
      const gitOps = new StubGitOps();
      await gitOps.createBranchRef('task/abc', 'origin/main');

      expect(await gitOps.refExists('task/abc')).toBe(true);
    });

    it('returns false when branch does not exist', async () => {
      const gitOps = new StubGitOps();

      expect(await gitOps.refExists('task/abc')).toBe(false);
    });

    it('respects throwIfConfigured for refExists', async () => {
      const gitOps = new StubGitOps();
      gitOps.setFailure('refExists', new Error('simulated failure'));

      await expect(gitOps.refExists('task/abc')).rejects.toThrow('simulated failure');
    });
  });

  describe('StubGitOps.deleteLocalBranch()', () => {
    it('removes the branch from the branches array', async () => {
      const gitOps = new StubGitOps();
      await gitOps.createBranchRef('task/abc', 'origin/main');
      expect(await gitOps.refExists('task/abc')).toBe(true);

      await gitOps.deleteLocalBranch('task/abc');
      expect(await gitOps.refExists('task/abc')).toBe(false);
    });

    it('is a no-op when branch does not exist', async () => {
      const gitOps = new StubGitOps();

      // Should not throw
      await gitOps.deleteLocalBranch('nonexistent');
      expect(await gitOps.refExists('nonexistent')).toBe(false);
    });

    it('respects throwIfConfigured for deleteLocalBranch', async () => {
      const gitOps = new StubGitOps();
      gitOps.setFailure('deleteLocalBranch', new Error('simulated failure'));

      await expect(gitOps.deleteLocalBranch('task/abc')).rejects.toThrow('simulated failure');
    });
  });

  describe('Ref conflict cleanup scenario', () => {
    it('deletes a flat branch before creating a hierarchical branch under the same prefix', async () => {
      const gitOps = new StubGitOps();

      // Simulate: flat branch "task/abc" exists from a previous run
      await gitOps.createBranchRef('task/abc', 'origin/main');
      expect(await gitOps.refExists('task/abc')).toBe(true);

      // Simulate the cleanup logic: check parent refs of "task/abc/integration"
      const targetBranch = 'task/abc/integration';
      const segments = targetBranch.split('/');
      for (let i = 1; i < segments.length; i++) {
        const parentRef = segments.slice(0, i).join('/');
        if (await gitOps.refExists(parentRef)) {
          await gitOps.deleteLocalBranch(parentRef);
        }
      }

      // Flat branch should be gone
      expect(await gitOps.refExists('task/abc')).toBe(false);

      // Now creating the hierarchical branch should succeed
      await gitOps.createBranchRef('task/abc/integration', 'origin/main');
      expect(await gitOps.refExists('task/abc/integration')).toBe(true);
    });

    it('leaves non-conflicting branches untouched', async () => {
      const gitOps = new StubGitOps();

      // "task/other" exists but is NOT a parent of "task/abc/integration"
      await gitOps.createBranchRef('task/other', 'origin/main');

      // Simulate cleanup for "task/abc/integration"
      const targetBranch = 'task/abc/integration';
      const segments = targetBranch.split('/');
      for (let i = 1; i < segments.length; i++) {
        const parentRef = segments.slice(0, i).join('/');
        if (await gitOps.refExists(parentRef)) {
          await gitOps.deleteLocalBranch(parentRef);
        }
      }

      // "task/other" should still exist — it's not a parent of the target branch
      expect(await gitOps.refExists('task/other')).toBe(true);
    });

    it('handles race-condition "not found" errors silently during cleanup', async () => {
      const gitOps = new StubGitOps();

      // Branch exists initially
      await gitOps.createBranchRef('task/abc', 'origin/main');

      // Simulate: another process deletes it between refExists and deleteLocalBranch
      // Configure deleteLocalBranch to throw "not found"
      gitOps.setFailure('deleteLocalBranch', new Error('error: branch not found'));

      const targetBranch = 'task/abc/integration';
      const segments = targetBranch.split('/');
      const errors: string[] = [];
      for (let i = 1; i < segments.length; i++) {
        const parentRef = segments.slice(0, i).join('/');
        try {
          const exists = await gitOps.refExists(parentRef);
          if (exists) {
            await gitOps.deleteLocalBranch(parentRef);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/not found|does not exist/.test(msg)) continue;
          errors.push(msg);
        }
      }

      // Race-condition "not found" should be silently ignored
      expect(errors).toHaveLength(0);
    });
  });
});
