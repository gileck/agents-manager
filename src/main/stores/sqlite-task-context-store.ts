import type Database from 'better-sqlite3';
import type { TaskContextEntry, TaskContextEntryCreateInput } from '../../shared/types';
import type { ITaskContextStore } from '../interfaces/task-context-store';
import { generateId, now, parseJson } from './utils';

interface TaskContextEntryRow {
  id: string;
  task_id: string;
  agent_run_id: string | null;
  source: string;
  entry_type: string;
  summary: string;
  data: string;
  created_at: number;
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
  };
}

export class SqliteTaskContextStore implements ITaskContextStore {
  constructor(private db: Database.Database) {}

  async addEntry(input: TaskContextEntryCreateInput): Promise<TaskContextEntry> {
    const id = generateId();
    const timestamp = now();

    this.db.prepare(`
      INSERT INTO task_context_entries (id, task_id, agent_run_id, source, entry_type, summary, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.taskId, input.agentRunId ?? null, input.source, input.entryType, input.summary, JSON.stringify(input.data ?? {}), timestamp);

    return {
      id,
      taskId: input.taskId,
      agentRunId: input.agentRunId ?? null,
      source: input.source,
      entryType: input.entryType,
      summary: input.summary,
      data: input.data ?? {},
      createdAt: timestamp,
    };
  }

  async getEntriesForTask(taskId: string): Promise<TaskContextEntry[]> {
    const rows = this.db.prepare(
      'SELECT * FROM task_context_entries WHERE task_id = ? ORDER BY created_at ASC'
    ).all(taskId) as TaskContextEntryRow[];
    return rows.map(rowToEntry);
  }
}
