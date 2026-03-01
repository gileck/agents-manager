import type Database from 'better-sqlite3';
import type { DebugTimelineEntry } from '../../../../shared/types';
import type { ITimelineSource } from '../types';
import { makeEntry } from '../make-entry';

function safeParse(json: string | null | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { return undefined; }
}

export class TransitionSource implements ITimelineSource {
  constructor(private db: Database.Database) {}

  getEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      'SELECT from_status, to_status, trigger, guard_results, created_at FROM transition_history WHERE task_id = ?'
    ).all(taskId) as { from_status: string; to_status: string; trigger: string; guard_results: string; created_at: number }[];

    return rows.map((r) =>
      makeEntry(
        r.created_at,
        'transition',
        'info',
        `${r.from_status} → ${r.to_status} (${r.trigger})`,
        { fromStatus: r.from_status, toStatus: r.to_status, trigger: r.trigger, guardResults: safeParse(r.guard_results) },
      )
    );
  }
}
