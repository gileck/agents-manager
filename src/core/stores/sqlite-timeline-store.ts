import type Database from 'better-sqlite3';
import type { DebugTimelineEntry } from '../../shared/types';
import type { ITimelineStore } from '../interfaces/timeline-store';
import { makeEntry } from '../services/timeline/make-entry';

function safeParse(json: string | null | undefined): Record<string, unknown> | undefined {
  if (!json) return undefined;
  try { return JSON.parse(json); } catch { return undefined; }
}

const categorySourceMap: Record<string, DebugTimelineEntry['source']> = {
  agent: 'agent',
  agent_debug: 'agent',
  git: 'git',
  github: 'github',
  worktree: 'worktree',
};

export class SqliteTimelineStore implements ITimelineStore {
  constructor(private db: Database.Database) {}

  getActivityEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      'SELECT summary, data, created_at FROM activity_log WHERE entity_id = ?'
    ).all(taskId) as { summary: string; data: string; created_at: number }[];

    return rows.map((r) =>
      makeEntry(r.created_at, 'activity', 'info', r.summary, safeParse(r.data))
    );
  }

  getAgentRunEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      'SELECT mode, agent_type, status, exit_code, outcome, cost_input_tokens, cost_output_tokens, started_at, completed_at, correlation_id FROM agent_runs WHERE task_id = ?'
    ).all(taskId) as { mode: string; agent_type: string; status: string; exit_code: number | null; outcome: string | null; cost_input_tokens: number | null; cost_output_tokens: number | null; started_at: number; completed_at: number | null; correlation_id: string | null }[];

    return rows.map((r) =>
      makeEntry(
        r.completed_at ?? r.started_at,
        'agent',
        r.status === 'failed' ? 'error' : 'info',
        `Agent ${r.mode}/${r.agent_type}: ${r.status}`,
        { exitCode: r.exit_code, outcome: r.outcome, inputTokens: r.cost_input_tokens, outputTokens: r.cost_output_tokens },
        r.correlation_id ?? undefined,
      )
    );
  }

  getArtifactEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      'SELECT type, data, created_at FROM task_artifacts WHERE task_id = ?'
    ).all(taskId) as { type: string; data: string; created_at: number }[];

    return rows.map((r) =>
      makeEntry(r.created_at, 'artifact', 'info', `Artifact: ${r.type}`, safeParse(r.data))
    );
  }

  getContextEntries(taskId: string): DebugTimelineEntry[] {
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

  getEventEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      "SELECT category, severity, message, data, created_at, correlation_id FROM task_events WHERE task_id = ? AND category != 'status_change'"
    ).all(taskId) as { category: string; severity: string; message: string; data: string; created_at: number; correlation_id: string | null }[];

    return rows.map((r) =>
      makeEntry(
        r.created_at,
        categorySourceMap[r.category] ?? 'event',
        (r.severity as DebugTimelineEntry['severity']) || 'info',
        r.message,
        { category: r.category, ...safeParse(r.data) },
        r.correlation_id ?? undefined,
      )
    );
  }

  getPhaseEntries(taskId: string): DebugTimelineEntry[] {
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

  getPromptEntries(taskId: string): DebugTimelineEntry[] {
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

  getTransitionEntries(taskId: string): DebugTimelineEntry[] {
    const rows = this.db.prepare(
      'SELECT from_status, to_status, trigger, guard_results, created_at, correlation_id FROM transition_history WHERE task_id = ?'
    ).all(taskId) as { from_status: string; to_status: string; trigger: string; guard_results: string; created_at: number; correlation_id: string | null }[];

    return rows.map((r) =>
      makeEntry(
        r.created_at,
        'transition',
        'info',
        `${r.from_status} → ${r.to_status} (${r.trigger})`,
        { fromStatus: r.from_status, toStatus: r.to_status, trigger: r.trigger, guardResults: safeParse(r.guard_results) },
        r.correlation_id ?? undefined,
      )
    );
  }
}
