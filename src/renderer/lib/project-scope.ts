/**
 * Read the projectId from the URL query parameter.
 * In Electron: file:///path/to/index.html?projectId=abc#/tasks
 * In Web: http://localhost:3847?projectId=abc#/tasks
 *
 * Returns null if the parameter is not present (un-scoped window).
 */
export function getProjectIdFromUrl(): string | null {
  const raw = new URLSearchParams(window.location.search).get('projectId');
  if (raw === null) return null; // param not present — intentionally un-scoped
  if (!raw.trim()) {
    console.warn('[project-scope] URL contains empty projectId parameter — treating as un-scoped');
    return null;
  }
  return raw;
}
