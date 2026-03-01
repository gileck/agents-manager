import type Database from 'better-sqlite3';
import type { DebugTimelineEntry } from '../../../../shared/types';
import type { ITimelineSource } from '../types';
import { makeEntry } from '../make-entry';

function safeParse(json: string | null | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { return undefined; }
}

export class PromptSource implements ITimelineSource {
  constructor(private db: Database.Database) {}

  getEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      'SELECT prompt_type, status, payload, response, created_at FROM pending_prompts WHERE task_id = ?'
    ).all(taskId) as { prompt_type: string; status: string; payload: string; response: string | null; created_at: number }[];

    return rows.map((r) =>
      makeEntry(
        r.created_at,
        'prompt',
        'info',
        `Prompt: ${r.prompt_type} (${r.status})`,
        { payload: safeParse(r.payload), response: safeParse(r.response) },
      )
    );
  }
}
