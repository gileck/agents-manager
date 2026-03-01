import type Database from 'better-sqlite3';
import type { DebugTimelineEntry } from '../../../../shared/types';
import type { ITimelineSource } from '../types';
import { makeEntry } from '../make-entry';

export class PhaseSource implements ITimelineSource {
  constructor(private db: Database.Database) {}

  getEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      'SELECT phase, status, started_at, completed_at FROM task_phases WHERE task_id = ?'
    ).all(taskId) as { phase: string; status: string; started_at: number | null; completed_at: number | null }[];

    return rows.map((r) =>
      makeEntry(
        r.started_at ?? r.completed_at ?? Date.now(),
        'phase',
        r.status === 'failed' ? 'error' : 'info',
        `Phase ${r.phase}: ${r.status}`,
      )
    );
  }
}
