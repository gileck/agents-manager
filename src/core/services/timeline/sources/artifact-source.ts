import type Database from 'better-sqlite3';
import type { DebugTimelineEntry } from '../../../../shared/types';
import type { ITimelineSource } from '../types';
import { makeEntry } from '../make-entry';

function safeParse(json: string | null | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { return undefined; }
}

export class ArtifactSource implements ITimelineSource {
  constructor(private db: Database.Database) {}

  getEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      'SELECT type, data, created_at FROM task_artifacts WHERE task_id = ?'
    ).all(taskId) as { type: string; data: string; created_at: number }[];

    return rows.map((r) =>
      makeEntry(r.created_at, 'artifact', 'info', `Artifact: ${r.type}`, safeParse(r.data))
    );
  }
}
