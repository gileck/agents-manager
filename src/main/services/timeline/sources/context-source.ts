import type Database from 'better-sqlite3';
import type { DebugTimelineEntry } from '../../../../shared/types';
import type { ITimelineSource } from '../types';
import { makeEntry } from '../make-entry';

export class ContextSource implements ITimelineSource {
  constructor(private db: Database.Database) {}

  getEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      'SELECT source, entry_type, summary, agent_run_id, created_at FROM task_context_entries WHERE task_id = ?'
    ).all(taskId) as { source: string; entry_type: string; summary: string; agent_run_id: string | null; created_at: number }[];

    return rows.map((r) =>
      makeEntry(
        r.created_at,
        'context',
        'info',
        `Context: [${r.source}] ${r.entry_type}`,
        { summary: r.summary.slice(0, 500), agentRunId: r.agent_run_id },
      )
    );
  }
}
