import type Database from 'better-sqlite3';
import type { DebugTimelineEntry } from '../../../../shared/types';
import type { ITimelineSource } from '../types';
import { makeEntry } from '../make-entry';

const categorySourceMap: Record<string, DebugTimelineEntry['source']> = {
  agent: 'agent',
  agent_debug: 'agent',
  git: 'git',
  github: 'github',
  worktree: 'worktree',
};

function safeParse(json: string | null | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { return undefined; }
}

export class EventSource implements ITimelineSource {
  constructor(private db: Database.Database) {}

  getEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      "SELECT category, severity, message, data, created_at FROM task_events WHERE task_id = ? AND category != 'status_change'"
    ).all(taskId) as { category: string; severity: string; message: string; data: string; created_at: number }[];

    return rows.map((r) =>
      makeEntry(
        r.created_at,
        categorySourceMap[r.category] ?? 'event',
        (r.severity as DebugTimelineEntry['severity']) || 'info',
        r.message,
        { category: r.category, ...safeParse(r.data) },
      )
    );
  }
}
