/**
 * Utility for transforming screenshot filesystem paths to API-friendly URLs.
 *
 * Screenshots saved via POST /api/screenshots are stored on disk under
 * `~/.agents-manager/screenshots/`. The GET /api/screenshots?path= endpoint
 * serves these files.  This helper rewrites absolute filesystem paths found in
 * markdown image sources so the browser can load them via the API.
 */

const SCREENSHOT_PATH_MARKER = '.agents-manager/screenshots/';

/**
 * Returns true when `src` looks like an absolute filesystem path pointing at a
 * screenshot inside the `.agents-manager/screenshots/` directory.
 */
export function isScreenshotFilePath(src: string): boolean {
  return src.includes(SCREENSHOT_PATH_MARKER);
}

/**
 * Converts an absolute filesystem screenshot path to an API URL that the
 * browser can fetch.
 *
 * If the path does not match the expected pattern it is returned unchanged.
 */
export function toScreenshotApiUrl(src: string): string {
  if (!isScreenshotFilePath(src)) return src;
  return `/api/screenshots?path=${encodeURIComponent(src)}`;
}
