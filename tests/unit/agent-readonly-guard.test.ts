/**
 * Unit tests for the read-only guard in Agent.execute().
 *
 * The readOnlyGuard is a preToolUse hook that blocks Write/Edit/MultiEdit/NotebookEdit
 * tools and destructive Bash commands for read-only agents. It fires via SDK hooks
 * (not canUseTool) so it cannot be bypassed by permissionMode: 'acceptEdits'.
 *
 * These tests exercise the exported buildReadOnlyGuard() helper directly to verify
 * guard logic without requiring a full Agent + AgentLib integration.
 */
import { describe, it, expect } from 'vitest';
import { buildReadOnlyGuard } from '../../src/core/agents/agent';

describe('readOnlyGuard', () => {
  const guard = buildReadOnlyGuard();

  // ============================================
  // Write tools — all should be blocked
  // ============================================
  describe('blocks write tools', () => {
    it('blocks Write tool', () => {
      const result = guard('Write', { file_path: '/tmp/worktree/src/index.ts' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
      expect(result!.reason).toContain('READ-ONLY GUARD');
      expect(result!.reason).toContain('Write');
    });

    it('blocks Edit tool', () => {
      const result = guard('Edit', { file_path: '/tmp/worktree/src/app.ts' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
      expect(result!.reason).toContain('READ-ONLY GUARD');
      expect(result!.reason).toContain('Edit');
    });

    it('blocks MultiEdit tool', () => {
      const result = guard('MultiEdit', { file_path: '/tmp/worktree/src/app.ts' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
      expect(result!.reason).toContain('READ-ONLY GUARD');
    });

    it('blocks NotebookEdit tool', () => {
      const result = guard('NotebookEdit', { notebook_path: '/tmp/worktree/notebook.ipynb' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
      expect(result!.reason).toContain('READ-ONLY GUARD');
    });
  });

  // ============================================
  // Read-only tools — all should be allowed
  // ============================================
  describe('allows read-only tools', () => {
    it('allows Read tool', () => {
      const result = guard('Read', { file_path: '/tmp/worktree/src/index.ts' });
      expect(result).toBeUndefined();
    });

    it('allows Glob tool', () => {
      const result = guard('Glob', { pattern: '**/*.ts' });
      expect(result).toBeUndefined();
    });

    it('allows Grep tool', () => {
      const result = guard('Grep', { pattern: 'function', path: '/tmp/worktree/src' });
      expect(result).toBeUndefined();
    });

    it('allows unknown/other tools', () => {
      const result = guard('WebSearch', { query: 'test' });
      expect(result).toBeUndefined();
    });
  });

  // ============================================
  // Read-only Bash commands — should be allowed
  // ============================================
  describe('allows read-only Bash commands', () => {
    it('allows git status', () => {
      const result = guard('Bash', { command: 'git status' });
      expect(result).toBeUndefined();
    });

    it('allows git diff', () => {
      const result = guard('Bash', { command: 'git diff HEAD~1' });
      expect(result).toBeUndefined();
    });

    it('allows git log', () => {
      const result = guard('Bash', { command: 'git log --oneline -10' });
      expect(result).toBeUndefined();
    });

    it('allows git show', () => {
      const result = guard('Bash', { command: 'git show HEAD:src/index.ts' });
      expect(result).toBeUndefined();
    });

    it('allows git branch (listing)', () => {
      const result = guard('Bash', { command: 'git branch -a' });
      expect(result).toBeUndefined();
    });

    it('allows ls', () => {
      const result = guard('Bash', { command: 'ls -la src/' });
      expect(result).toBeUndefined();
    });

    it('allows cat', () => {
      const result = guard('Bash', { command: 'cat src/index.ts' });
      expect(result).toBeUndefined();
    });

    it('allows echo (no redirect)', () => {
      const result = guard('Bash', { command: 'echo "hello world"' });
      expect(result).toBeUndefined();
    });

    it('allows yarn/npm read commands', () => {
      const result = guard('Bash', { command: 'yarn list --depth=0' });
      expect(result).toBeUndefined();
    });

    it('allows wc', () => {
      const result = guard('Bash', { command: 'wc -l src/index.ts' });
      expect(result).toBeUndefined();
    });

    it('allows find', () => {
      const result = guard('Bash', { command: 'find src -name "*.ts"' });
      expect(result).toBeUndefined();
    });

    it('allows Bash with no command', () => {
      const result = guard('Bash', {});
      expect(result).toBeUndefined();
    });
  });

  // ============================================
  // Destructive Bash commands — should be blocked
  // ============================================
  describe('blocks destructive Bash commands', () => {
    it('blocks rm', () => {
      const result = guard('Bash', { command: 'rm -rf src/' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
      expect(result!.reason).toContain('READ-ONLY GUARD');
    });

    it('blocks rm with path', () => {
      const result = guard('Bash', { command: 'rm /tmp/worktree/file.ts' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git commit', () => {
      const result = guard('Bash', { command: 'git commit -m "changes"' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git push', () => {
      const result = guard('Bash', { command: 'git push origin main' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git merge', () => {
      const result = guard('Bash', { command: 'git merge feature-branch' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git rebase', () => {
      const result = guard('Bash', { command: 'git rebase origin/main' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git reset', () => {
      const result = guard('Bash', { command: 'git reset --hard HEAD~1' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git clean', () => {
      const result = guard('Bash', { command: 'git clean -fd' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git add', () => {
      const result = guard('Bash', { command: 'git add .' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git cherry-pick', () => {
      const result = guard('Bash', { command: 'git cherry-pick abc123' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git revert', () => {
      const result = guard('Bash', { command: 'git revert HEAD' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git tag', () => {
      const result = guard('Bash', { command: 'git tag v1.0.0' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git branch -d', () => {
      const result = guard('Bash', { command: 'git branch -d feature-branch' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks git branch -D', () => {
      const result = guard('Bash', { command: 'git branch -D feature-branch' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks mkdir', () => {
      const result = guard('Bash', { command: 'mkdir -p src/new-dir' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks touch', () => {
      const result = guard('Bash', { command: 'touch src/new-file.ts' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks chmod', () => {
      const result = guard('Bash', { command: 'chmod +x script.sh' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks chown', () => {
      const result = guard('Bash', { command: 'chown user:group file.txt' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks mv', () => {
      const result = guard('Bash', { command: 'mv src/old.ts src/new.ts' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks cp', () => {
      const result = guard('Bash', { command: 'cp src/index.ts src/backup.ts' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks tee', () => {
      const result = guard('Bash', { command: 'echo "data" | tee output.txt' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks redirect (overwrite)', () => {
      const result = guard('Bash', { command: 'echo "data" > output.txt' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks redirect (append)', () => {
      const result = guard('Bash', { command: 'echo "data" >> output.txt' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks chained destructive commands', () => {
      const result = guard('Bash', { command: 'git status && git add . && git commit -m "test"' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('blocks piped destructive commands', () => {
      const result = guard('Bash', { command: 'find . -name "*.tmp" | xargs rm -f' });
      expect(result).toBeDefined();
      expect(result!.decision).toBe('block');
    });

    it('truncates long commands in the reason message', () => {
      const longCommand = 'rm ' + 'x'.repeat(200);
      const result = guard('Bash', { command: longCommand });
      expect(result).toBeDefined();
      expect(result!.reason.length).toBeLessThan(300);
    });
  });

  // ============================================
  // Non-read-only agents — guard should not exist
  // ============================================
  describe('guard is null for non-read-only agents', () => {
    it('buildReadOnlyGuard returns a guard function (always)', () => {
      // The guard is always built; it is only wired when execConfig.readOnly is true.
      // This test validates that the function itself works correctly.
      const g = buildReadOnlyGuard();
      expect(typeof g).toBe('function');
    });
  });
});
