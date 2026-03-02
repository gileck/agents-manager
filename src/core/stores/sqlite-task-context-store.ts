import type Database from 'better-sqlite3';
import type { TaskContextEntry, TaskContextEntryCreateInput } from '../../shared/types';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import { generateId, now, parseJson } from './utils';
import { getAppLogger } from '../services/app-logger';

interface TaskContextEntryRow {
  id: string;
  task_id: string;
  agent_run_id: string | null;
  source: string;
  entry_type: string;
  summary: string;
  data: string;
  created_at: number;
  addressed: number;
  addressed_by_run_id: string | null;
}

function rowToEntry(row: TaskContextEntryRow): TaskContextEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    agentRunId: row.agent_run_id,
    source: row.source,
    entryType: row.entry_type,
    summary: row.summary,
    data: parseJson<Record<string, unknown>>(row.data, {}),
    createdAt: row.created_at,
    addressed: row.addressed === 1,
    addressedByRunId: row.addressed_by_run_id,
  };
}

export class SqliteTaskContextStore implements ITaskContextStore {
  constructor(private db: Database.Database) {}

  async addEntry(input: TaskContextEntryCreateInput): Promise<TaskContextEntry> {
    try {
      const id = generateId();
      const timestamp = now();
      const addressed = input.addressed ? 1 : 0;

      this.db.prepare(`
        INSERT INTO task_context_entries (id, task_id, agent_run_id, source, entry_type, summary, data, created_at, addressed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.taskId, input.agentRunId ?? null, input.source, input.entryType, input.summary, JSON.stringify(input.data ?? {}), timestamp, addressed);

      return {
        id,
        taskId: input.taskId,
        agentRunId: input.agentRunId ?? null,
        source: input.source,
        entryType: input.entryType,
        summary: input.summary,
        data: input.data ?? {},
        createdAt: timestamp,
        addressed: !!input.addressed,
        addressedByRunId: null,
      };
    } catch (err) {
      getAppLogger().logError('TaskContextStore', 'addEntry failed', err);
      throw err;
    }
  }

  async getEntriesForTask(taskId: string): Promise<TaskContextEntry[]> {
    try {
      const rows = this.db.prepare(
        'SELECT * FROM task_context_entries WHERE task_id = ? ORDER BY created_at ASC'
      ).all(taskId) as TaskContextEntryRow[];
      return rows.map(rowToEntry);
    } catch (err) {
      getAppLogger().logError('TaskContextStore', 'getEntriesForTask failed', err);
      throw err;
    }
  }

  async markEntriesAsAddressed(taskId: string, entryTypes: string[], addressedByRunId: string): Promise<number> {
    try {
      const placeholders = entryTypes.map(() => '?').join(', ');
      const result = this.db.prepare(`
        UPDATE task_context_entries
        SET addressed = 1, addressed_by_run_id = ?
        WHERE task_id = ? AND entry_type IN (${placeholders}) AND addressed = 0
      `).run(addressedByRunId, taskId, ...entryTypes);
      return result.changes;
    } catch (err) {
      getAppLogger().logError('TaskContextStore', 'markEntriesAsAddressed failed', err);
      throw err;
    }
  }
}
