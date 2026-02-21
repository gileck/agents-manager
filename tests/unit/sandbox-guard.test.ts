import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SandboxGuard } from '../../src/main/services/sandbox-guard';

// Mock fs.realpathSync to return the input as-is (avoid filesystem dependency)
vi.mock('fs', () => ({
  realpathSync: (p: string) => p,
}));

describe('SandboxGuard', () => {
  let guard: SandboxGuard;

  beforeEach(() => {
    guard = new SandboxGuard(['/tmp/project'], ['/tmp/readonly']);
  });

  // ============================================
  // Write tool validation
  // ============================================
  describe('Write tool', () => {
    it('should allow write to path within allowedPaths', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/tmp/project/src/index.ts' });
      expect(result.allow).toBe(true);
    });

    it('should allow write to the allowed path itself', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/tmp/project' });
      expect(result.allow).toBe(true);
    });

    it('should block write to path outside allowedPaths', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/home/user/secret.txt' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('Write outside allowed paths');
    });

    it('should block write to readOnly paths', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/tmp/readonly/data.json' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('Write outside allowed paths');
    });

    it('should block write to ~/.ssh/', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/home/user/.ssh/id_rsa' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('sensitive path');
    });

    it('should block write to ~/.aws/', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/home/user/.aws/credentials' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('sensitive path');
    });

    it('should block write to ~/.gnupg/', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/home/user/.gnupg/secring.gpg' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('sensitive path');
    });

    it('should block write to .env files', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/tmp/project/.env' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('sensitive path');
    });

    it('should block write to ~/.config/', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/home/user/.config/settings.json' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('sensitive path');
    });

    it('should allow write when file_path is undefined', () => {
      const result = guard.evaluateToolCall('Write', {});
      expect(result.allow).toBe(true);
    });
  });

  // ============================================
  // Read tool validation
  // ============================================
  describe('Read tool', () => {
    it('should allow read from allowedPaths', () => {
      const result = guard.evaluateToolCall('Read', { file_path: '/tmp/project/README.md' });
      expect(result.allow).toBe(true);
    });

    it('should allow read from readOnlyPaths', () => {
      const result = guard.evaluateToolCall('Read', { file_path: '/tmp/readonly/config.json' });
      expect(result.allow).toBe(true);
    });

    it('should block read from sensitive paths', () => {
      const result = guard.evaluateToolCall('Read', { file_path: '/home/user/.ssh/id_rsa' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('sensitive path');
    });

    it('should block read from outside both allowed and readOnly', () => {
      const result = guard.evaluateToolCall('Read', { file_path: '/var/log/syslog' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('Read outside allowed paths');
    });

    it('should allow read when file_path is undefined', () => {
      const result = guard.evaluateToolCall('Read', {});
      expect(result.allow).toBe(true);
    });

    it('should support path property for read', () => {
      const result = guard.evaluateToolCall('Read', { path: '/tmp/project/file.ts' });
      expect(result.allow).toBe(true);
    });

    it('should support directory property for read', () => {
      const result = guard.evaluateToolCall('Read', { directory: '/tmp/project/src' });
      expect(result.allow).toBe(true);
    });
  });

  // ============================================
  // Edit tool validation (same rules as Write)
  // ============================================
  describe('Edit tool', () => {
    it('should allow edit within allowedPaths', () => {
      const result = guard.evaluateToolCall('Edit', { file_path: '/tmp/project/src/app.ts' });
      expect(result.allow).toBe(true);
    });

    it('should block edit outside allowedPaths', () => {
      const result = guard.evaluateToolCall('Edit', { file_path: '/home/user/file.txt' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('Write outside allowed paths');
    });

    it('should block edit to sensitive paths', () => {
      const result = guard.evaluateToolCall('Edit', { file_path: '/home/user/.aws/config' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('sensitive path');
    });

    it('should block edit to readOnly paths (write not allowed)', () => {
      const result = guard.evaluateToolCall('Edit', { file_path: '/tmp/readonly/data.txt' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('Write outside allowed paths');
    });
  });

  // ============================================
  // MultiEdit tool validation (same as Write)
  // ============================================
  describe('MultiEdit tool', () => {
    it('should allow multiEdit within allowedPaths', () => {
      const result = guard.evaluateToolCall('MultiEdit', { file_path: '/tmp/project/multi.ts' });
      expect(result.allow).toBe(true);
    });

    it('should block multiEdit outside allowedPaths', () => {
      const result = guard.evaluateToolCall('MultiEdit', { file_path: '/other/path/file.ts' });
      expect(result.allow).toBe(false);
    });
  });

  // ============================================
  // NotebookEdit tool validation
  // ============================================
  describe('NotebookEdit tool', () => {
    it('should allow notebookEdit within allowedPaths', () => {
      const result = guard.evaluateToolCall('NotebookEdit', { notebook_path: '/tmp/project/notebook.ipynb' });
      expect(result.allow).toBe(true);
    });

    it('should block notebookEdit outside allowedPaths', () => {
      const result = guard.evaluateToolCall('NotebookEdit', { notebook_path: '/other/notebook.ipynb' });
      expect(result.allow).toBe(false);
    });
  });

  // ============================================
  // Bash command validation
  // ============================================
  describe('Bash tool', () => {
    it('should allow bash commands operating within allowed paths', () => {
      const result = guard.evaluateToolCall('Bash', { command: 'cat /tmp/project/src/index.ts' });
      expect(result.allow).toBe(true);
    });

    it('should block bash commands with paths to sensitive locations', () => {
      const result = guard.evaluateToolCall('Bash', { command: 'cat /home/user/.ssh/id_rsa' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('sensitive path');
    });

    it('should block bash commands accessing paths outside boundaries', () => {
      const result = guard.evaluateToolCall('Bash', { command: 'rm /var/log/syslog' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('outside boundaries');
    });

    it('should handle quoted paths in bash commands', () => {
      const result = guard.evaluateToolCall('Bash', { command: 'cat "/tmp/project/file with spaces.txt"' });
      expect(result.allow).toBe(true);
    });

    it('should allow bash commands with no file paths', () => {
      const result = guard.evaluateToolCall('Bash', { command: 'echo hello' });
      expect(result.allow).toBe(true);
    });

    it('should allow when command is undefined', () => {
      const result = guard.evaluateToolCall('Bash', {});
      expect(result.allow).toBe(true);
    });

    it('should allow read-only paths for bash read commands', () => {
      const result = guard.evaluateToolCall('Bash', { command: 'cat /tmp/readonly/data.json' });
      expect(result.allow).toBe(true);
    });

    it('should handle cd commands', () => {
      const result = guard.evaluateToolCall('Bash', { command: 'cd /tmp/project/src' });
      expect(result.allow).toBe(true);
    });

    it('should block cd to outside paths', () => {
      const result = guard.evaluateToolCall('Bash', { command: 'cd /var/secret' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('outside boundaries');
    });

    it('should handle multiple commands with paths', () => {
      const result = guard.evaluateToolCall('Bash', { command: 'cat /tmp/project/a.txt && rm /tmp/project/b.txt' });
      expect(result.allow).toBe(true);
    });

    it('should block if any path in multi-command is outside boundaries', () => {
      const result = guard.evaluateToolCall('Bash', { command: 'cat /tmp/project/a.txt && rm /var/secret/b.txt' });
      expect(result.allow).toBe(false);
    });
  });

  // ============================================
  // Glob/Grep tool validation
  // ============================================
  describe('Glob tool', () => {
    it('should allow glob within allowed paths', () => {
      const result = guard.evaluateToolCall('Glob', { path: '/tmp/project/src' });
      expect(result.allow).toBe(true);
    });

    it('should allow glob within readOnly paths', () => {
      const result = guard.evaluateToolCall('Glob', { path: '/tmp/readonly/data' });
      expect(result.allow).toBe(true);
    });

    it('should block glob outside boundaries', () => {
      const result = guard.evaluateToolCall('Glob', { path: '/var/log' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('Read outside allowed paths');
    });

    it('should allow when path is undefined', () => {
      const result = guard.evaluateToolCall('Glob', {});
      expect(result.allow).toBe(true);
    });
  });

  describe('Grep tool', () => {
    it('should allow grep within allowed paths', () => {
      const result = guard.evaluateToolCall('Grep', { path: '/tmp/project' });
      expect(result.allow).toBe(true);
    });

    it('should allow grep within readOnly paths', () => {
      const result = guard.evaluateToolCall('Grep', { path: '/tmp/readonly' });
      expect(result.allow).toBe(true);
    });

    it('should block grep outside boundaries', () => {
      const result = guard.evaluateToolCall('Grep', { path: '/etc/passwd' });
      expect(result.allow).toBe(false);
    });
  });

  // ============================================
  // Unknown tool handling
  // ============================================
  describe('Unknown tool handling', () => {
    it('should default to allow for unknown tools', () => {
      const result = guard.evaluateToolCall('SomeUnknownTool', { path: '/anywhere' });
      expect(result.allow).toBe(true);
    });

    it('should allow unknown tool with no input', () => {
      const result = guard.evaluateToolCall('CustomTool', {});
      expect(result.allow).toBe(true);
    });
  });

  // ============================================
  // Edge cases
  // ============================================
  describe('Edge cases', () => {
    it('should block path traversal attempts (../../../etc/passwd)', () => {
      const result = guard.evaluateToolCall('Read', { file_path: '/tmp/project/../../../etc/passwd' });
      expect(result.allow).toBe(false);
    });

    it('should allow empty path (treated as undefined)', () => {
      // Empty string is falsy, checkReadPath/checkWritePath treat it as no path
      const resultRead = guard.evaluateToolCall('Read', { file_path: '' });
      expect(resultRead.allow).toBe(true);

      const resultWrite = guard.evaluateToolCall('Write', { file_path: '' });
      expect(resultWrite.allow).toBe(true);
    });

    it('should handle path exactly matching allowed boundary', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/tmp/project' });
      expect(result.allow).toBe(true);
    });

    it('should handle path exactly matching readOnly boundary', () => {
      const result = guard.evaluateToolCall('Read', { file_path: '/tmp/readonly' });
      expect(result.allow).toBe(true);
    });

    it('should NOT allow a prefix path that is not a subdir', () => {
      // /tmp/project-other should NOT match /tmp/project
      const result = guard.evaluateToolCall('Write', { file_path: '/tmp/project-other/file.txt' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('Write outside allowed paths');
    });

    it('should NOT allow a prefix path for readOnly that is not a subdir', () => {
      const result = guard.evaluateToolCall('Read', { file_path: '/tmp/readonlyextra/file.txt' });
      expect(result.allow).toBe(false);
    });

    it('should handle guard with no readOnly paths', () => {
      const noReadOnlyGuard = new SandboxGuard(['/tmp/project']);
      const result = noReadOnlyGuard.evaluateToolCall('Read', { file_path: '/tmp/project/file.ts' });
      expect(result.allow).toBe(true);

      const resultOutside = noReadOnlyGuard.evaluateToolCall('Read', { file_path: '/var/other' });
      expect(resultOutside.allow).toBe(false);
    });

    it('should handle guard with multiple allowed paths', () => {
      const multiGuard = new SandboxGuard(['/tmp/project', '/tmp/other']);
      expect(multiGuard.evaluateToolCall('Write', { file_path: '/tmp/project/a.ts' }).allow).toBe(true);
      expect(multiGuard.evaluateToolCall('Write', { file_path: '/tmp/other/b.ts' }).allow).toBe(true);
      expect(multiGuard.evaluateToolCall('Write', { file_path: '/tmp/nope/c.ts' }).allow).toBe(false);
    });

    it('should block /etc paths as sensitive', () => {
      const result = guard.evaluateToolCall('Read', { file_path: '/etc/passwd' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('sensitive path');
    });

    it('should block .env files within allowed paths as sensitive', () => {
      const result = guard.evaluateToolCall('Write', { file_path: '/tmp/project/.env.local' });
      expect(result.allow).toBe(false);
      expect(result.reason).toContain('sensitive path');
    });
  });
});
