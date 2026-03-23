import { describe, it, expect, vi, afterEach } from 'vitest';
import * as path from 'path';

describe('user-paths utility', () => {
  // Fresh import for each test to pick up env changes
  async function importModule() {
    // Bust module cache so env var changes take effect
    const mod = await import('../../src/core/utils/user-paths');
    return mod;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('getUserDataDir', () => {
    it('returns ~/.agents-manager/ under $HOME', async () => {
      vi.stubEnv('HOME', '/Users/testuser');
      const { getUserDataDir } = await importModule();
      expect(getUserDataDir()).toBe(path.join('/Users/testuser', '.agents-manager'));
    });
  });

  describe('getScreenshotStorageDir', () => {
    it('returns ~/.agents-manager/screenshots/', async () => {
      vi.stubEnv('HOME', '/Users/testuser');
      const { getScreenshotStorageDir } = await importModule();
      expect(getScreenshotStorageDir()).toBe(
        path.join('/Users/testuser', '.agents-manager', 'screenshots'),
      );
    });
  });

  describe('getChatImagesStorageDir', () => {
    it('returns ~/.agents-manager/chat-images/', async () => {
      vi.stubEnv('HOME', '/Users/testuser');
      const { getChatImagesStorageDir } = await importModule();
      expect(getChatImagesStorageDir()).toBe(
        path.join('/Users/testuser', '.agents-manager', 'chat-images'),
      );
    });
  });

  describe('getGlobalAgentReadOnlyPaths', () => {
    it('returns screenshot and chat-images directories', async () => {
      vi.stubEnv('HOME', '/Users/testuser');
      const { getGlobalAgentReadOnlyPaths, getScreenshotStorageDir, getChatImagesStorageDir } = await importModule();
      const paths = getGlobalAgentReadOnlyPaths();
      expect(paths).toEqual([
        getScreenshotStorageDir(),
        getChatImagesStorageDir(),
      ]);
    });

    it('returns exactly two paths', async () => {
      const { getGlobalAgentReadOnlyPaths } = await importModule();
      const paths = getGlobalAgentReadOnlyPaths();
      expect(paths).toHaveLength(2);
    });

    it('all paths are under the user data directory', async () => {
      vi.stubEnv('HOME', '/Users/testuser');
      const { getGlobalAgentReadOnlyPaths, getUserDataDir } = await importModule();
      const baseDir = getUserDataDir();
      for (const p of getGlobalAgentReadOnlyPaths()) {
        expect(p.startsWith(baseDir + path.sep)).toBe(true);
      }
    });
  });
});
