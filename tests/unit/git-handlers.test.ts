import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests that the git IPC handlers correctly unwrap daemon response objects
 * before passing values to the renderer. The daemon returns wrapped objects
 * like { diff: "..." } or { status: "..." }, but the preload contract
 * expects plain strings.
 */

// Capture registered handlers
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('@template/main/ipc/ipc-registry', () => ({
  registerIpcHandler: (channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

// Import after mocks are set up
const { IPC_CHANNELS } = await import('../../src/shared/ipc-channels');
const { registerGitHandlers } = await import('../../src/main/ipc-handlers/git-handlers');

describe('git IPC handlers', () => {
  const mockApi = {
    git: {
      getDiff: vi.fn(),
      getStat: vi.fn(),
      getWorkingDiff: vi.fn(),
      getStatus: vi.fn(),
      resetFile: vi.fn(),
      clean: vi.fn(),
      pull: vi.fn(),
      getLog: vi.fn(),
      showCommit: vi.fn(),
      getPRChecks: vi.fn(),
      getProjectLog: vi.fn(),
      getProjectBranch: vi.fn(),
      getProjectCommit: vi.fn(),
    },
  };

  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerGitHandlers(mockApi as never);
  });

  const fakeEvent = {} as never;

  describe('GIT_DIFF', () => {
    it('returns unwrapped diff string', async () => {
      mockApi.git.getDiff.mockResolvedValue({ diff: 'diff --git a/file' });
      const handler = handlers.get(IPC_CHANNELS.GIT_DIFF)!;
      const result = await handler(fakeEvent, 'task-1');
      expect(result).toBe('diff --git a/file');
    });

    it('returns null when response is null', async () => {
      mockApi.git.getDiff.mockResolvedValue(null);
      const handler = handlers.get(IPC_CHANNELS.GIT_DIFF)!;
      const result = await handler(fakeEvent, 'task-1');
      expect(result).toBeNull();
    });
  });

  describe('GIT_WORKING_DIFF', () => {
    it('returns unwrapped diff string', async () => {
      mockApi.git.getWorkingDiff.mockResolvedValue({ diff: 'working diff content' });
      const handler = handlers.get(IPC_CHANNELS.GIT_WORKING_DIFF)!;
      const result = await handler(fakeEvent, 'task-1');
      expect(result).toBe('working diff content');
    });

    it('returns null when response is null', async () => {
      mockApi.git.getWorkingDiff.mockResolvedValue(null);
      const handler = handlers.get(IPC_CHANNELS.GIT_WORKING_DIFF)!;
      const result = await handler(fakeEvent, 'task-1');
      expect(result).toBeNull();
    });
  });

  describe('GIT_STATUS', () => {
    it('returns unwrapped status string', async () => {
      mockApi.git.getStatus.mockResolvedValue({ status: 'M  src/file.ts' });
      const handler = handlers.get(IPC_CHANNELS.GIT_STATUS)!;
      const result = await handler(fakeEvent, 'task-1');
      expect(result).toBe('M  src/file.ts');
    });

    it('returns null when response is null', async () => {
      mockApi.git.getStatus.mockResolvedValue(null);
      const handler = handlers.get(IPC_CHANNELS.GIT_STATUS)!;
      const result = await handler(fakeEvent, 'task-1');
      expect(result).toBeNull();
    });
  });
});
