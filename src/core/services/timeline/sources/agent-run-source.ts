import type Database from 'better-sqlite3';
import type { DebugTimelineEntry } from '../../../../shared/types';
import type { ITimelineSource } from '../types';
import { makeEntry } from '../make-entry';

export class AgentRunSource implements ITimelineSource {
  constructor(private db: Database.Database) {}

  getEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      'SELECT mode, agent_type, status, exit_code, outcome, cost_input_tokens, cost_output_tokens, started_at, completed_at FROM agent_runs WHERE task_id = ?'
    ).all(taskId) as { mode: string; agent_type: string; status: string; exit_code: number | null; outcome: string | null; cost_input_tokens: number | null; cost_output_tokens: number | null; started_at: number; completed_at: number | null }[];

    return rows.map((r) =>
      makeEntry(
        r.completed_at ?? r.started_at,
        'agent',
        r.status === 'failed' ? 'error' : 'info',
        `Agent ${r.mode}/${r.agent_type}: ${r.status}`,
        { exitCode: r.exit_code, outcome: r.outcome, inputTokens: r.cost_input_tokens, outputTokens: r.cost_output_tokens },
      )
    );
  }
}
