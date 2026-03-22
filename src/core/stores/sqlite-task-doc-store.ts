import type Database from 'better-sqlite3';
import type { TaskDoc, TaskDocCreateInput, DocArtifactType } from '../../shared/types';
import type { ITaskDocStore } from '../interfaces/task-doc-store';
import { generateId, now } from './utils';
import { getAppLogger } from '../services/app-logger';

interface TaskDocRow {
  id: string;
  task_id: string;
  type: string;
  content: string;
  summary: string | null;
  created_at: number;
  updated_at: number;
}

function rowToTaskDoc(row: TaskDocRow): TaskDoc {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type as DocArtifactType,
    content: row.content,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteTaskDocStore implements ITaskDocStore {
  constructor(private db: Database.Database) {}

  async upsert(input: TaskDocCreateInput): Promise<TaskDoc> {
    try {
      const id = generateId();
      const timestamp = now();
      const summary = input.summary ?? null;

      this.db.prepare(`
        INSERT INTO task_docs (id, task_id, type, content, summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id, type) DO UPDATE SET
          content = excluded.content,
          summary = excluded.summary,
          updated_at = excluded.updated_at
      `).run(id, input.taskId, input.type, input.content, summary, timestamp, timestamp);

      // Fetch the actual row (in case it was an update, the id may differ)
      const row = this.db.prepare(
        'SELECT * FROM task_docs WHERE task_id = ? AND type = ?',
      ).get(input.taskId, input.type) as TaskDocRow;

      return rowToTaskDoc(row);
    } catch (err) {
      getAppLogger().logError('TaskDocStore', 'upsert failed', err);
      throw err;
    }
  }

  async getByTaskId(taskId: string): Promise<TaskDoc[]> {
    try {
      const rows = this.db.prepare(
        'SELECT * FROM task_docs WHERE task_id = ? ORDER BY created_at ASC',
      ).all(taskId) as TaskDocRow[];
      return rows.map(rowToTaskDoc);
    } catch (err) {
      getAppLogger().logError('TaskDocStore', 'getByTaskId failed', err);
      throw err;
    }
  }

  async getByTaskIdAndType(taskId: string, type: DocArtifactType): Promise<TaskDoc | null> {
    try {
      const row = this.db.prepare(
        'SELECT * FROM task_docs WHERE task_id = ? AND type = ?',
      ).get(taskId, type) as TaskDocRow | undefined;
      return row ? rowToTaskDoc(row) : null;
    } catch (err) {
      getAppLogger().logError('TaskDocStore', 'getByTaskIdAndType failed', err);
      throw err;
    }
  }

  async deleteByTaskId(taskId: string): Promise<void> {
    try {
      this.db.prepare('DELETE FROM task_docs WHERE task_id = ?').run(taskId);
    } catch (err) {
      getAppLogger().logError('TaskDocStore', 'deleteByTaskId failed', err);
      throw err;
    }
  }
}
