import { describe, it, expect } from 'vitest';
import { isScreenshotFilePath, toScreenshotApiUrl } from '../../src/renderer/utils/screenshot-url';

describe('screenshot-url utils', () => {
  describe('isScreenshotFilePath', () => {
    it('returns true for absolute macOS screenshot paths', () => {
      expect(isScreenshotFilePath(
        '/Users/gileck/.agents-manager/screenshots/6efbc4ee-2243-4bee-a5a1-b70e84f7ee6b.png',
      )).toBe(true);
    });

    it('returns true for absolute Linux screenshot paths', () => {
      expect(isScreenshotFilePath(
        '/home/user/.agents-manager/screenshots/abc123.jpg',
      )).toBe(true);
    });

    it('returns false for regular URLs', () => {
      expect(isScreenshotFilePath('https://example.com/image.png')).toBe(false);
    });

    it('returns false for relative image paths without the marker', () => {
      expect(isScreenshotFilePath('/images/logo.png')).toBe(false);
    });

    it('returns false for API URLs (already transformed)', () => {
      expect(isScreenshotFilePath(
        '/api/screenshots?path=%2FUsers%2Fgileck%2F.agents-manager%2Fscreenshots%2Fabc.png',
      )).toBe(false);
    });
  });

  describe('toScreenshotApiUrl', () => {
    it('rewrites an absolute filesystem screenshot path to an API URL', () => {
      const fsPath = '/Users/gileck/.agents-manager/screenshots/6efbc4ee.png';
      const result = toScreenshotApiUrl(fsPath);
      expect(result).toBe(
        `/api/screenshots?path=${encodeURIComponent(fsPath)}`,
      );
    });

    it('returns non-screenshot paths unchanged', () => {
      expect(toScreenshotApiUrl('https://example.com/image.png'))
        .toBe('https://example.com/image.png');
    });

    it('returns regular relative paths unchanged', () => {
      expect(toScreenshotApiUrl('/images/logo.png'))
        .toBe('/images/logo.png');
    });

    it('returns already-transformed API URLs unchanged', () => {
      const apiUrl = '/api/screenshots?path=%2FUsers%2Fgileck%2F.agents-manager%2Fscreenshots%2Fabc.png';
      expect(toScreenshotApiUrl(apiUrl)).toBe(apiUrl);
    });

    it('correctly encodes special characters in the path', () => {
      const fsPath = '/Users/some user/.agents-manager/screenshots/file name.png';
      const result = toScreenshotApiUrl(fsPath);
      expect(result).toBe(
        `/api/screenshots?path=${encodeURIComponent(fsPath)}`,
      );
      // The encoded URL should contain %20 for spaces
      expect(result).toContain('%20');
    });
  });
});
