import type { Task } from '../../shared/types';

/**
 * Fetch all bug tasks by querying both `{ type: 'bug' }` and `{ tag: 'bug' }`,
 * then merge and deduplicate. This ensures backwards compatibility with bugs
 * that were created with `type: 'feature'` + `tags: ['bug']` (the old error-handler bug).
 */
export async function fetchAllBugs(): Promise<Task[]> {
  const [byType, byTag] = await Promise.all([
    window.api.tasks.list({ type: 'bug' }),
    window.api.tasks.list({ tag: 'bug' }),
  ]);
  const seen = new Set<string>();
  const merged: Task[] = [];
  for (const t of [...byType, ...byTag]) {
    if (!seen.has(t.id)) {
      seen.add(t.id);
      merged.push(t);
    }
  }
  return merged;
}
