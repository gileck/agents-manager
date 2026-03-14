import type Database from 'better-sqlite3';
import type { TaskEvent, TaskEventCreateInput, TaskEventFilter } from '../../shared/types';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import { generateId, now, parseJson } from './utils';
import { getAppLogger } from '../services/app-logger';

interface TaskEventRow {
  id: string;
  task_id: string;
  category: string;
  severity: string;
  message: string;
  data: string;
  created_at: number;
  dismissed: number;
}

function rowToEvent(row: TaskEventRow): TaskEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    category: row.category as TaskEvent['category'],
    severity: row.severity as TaskEvent['severity'],
    message: row.message,
    data: parseJson<Record<string, unknown>>(row.data, {}),
    createdAt: row.created_at,
    dismissed: (row.dismissed ?? 0) === 1,
  };
}

export class SqliteTaskEventLog implements ITaskEventLog {
  constructor(private db: Database.Database) {}

  async log(input: TaskEventCreateInput): Promise<TaskEvent> {
    try {
      const id = generateId();
      const timestamp = now();

      this.db.prepare(`
        INSERT INTO task_events (id, task_id, category, severity, message, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.taskId,
        input.category,
        input.severity ?? 'info',
        input.message,
        JSON.stringify(input.data ?? {}),
        timestamp,
      );

      return {
        id,
        taskId: input.taskId,
        category: input.category,
        severity: input.severity ?? 'info',
        message: input.message,
        data: input.data ?? {},
        createdAt: timestamp,
      };
    } catch (err) {
      getAppLogger().logError('TaskEventLog', 'log failed', err);
      throw err;
    }
  }

  async dismissEvent(eventId: string): Promise<void> {
    try {
      this.db.prepare(`UPDATE task_events SET dismissed = 1 WHERE id = ?`).run(eventId);
    } catch (err) {
      getAppLogger().logError('TaskEventLog', 'dismissEvent failed', err);
      throw err;
    }
  }

  async getEvents(filter?: TaskEventFilter): Promise<TaskEvent[]> {
    try {
      const conditions: string[] = [];
      const values: unknown[] = [];

      if (filter?.taskId) {
        conditions.push('task_id = ?');
        values.push(filter.taskId);
      }
      if (filter?.category) {
        conditions.push('category = ?');
        values.push(filter.category);
      }
      if (filter?.severity) {
        conditions.push('severity = ?');
        values.push(filter.severity);
      }
      if (filter?.since !== undefined) {
        conditions.push('created_at >= ?');
        values.push(filter.since);
      }
      if (filter?.until !== undefined) {
        conditions.push('created_at <= ?');
        values.push(filter.until);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = filter?.limit ?? 5000;
      const rows = this.db.prepare(`SELECT * FROM task_events ${where} ORDER BY created_at ASC LIMIT ?`).all(...values, limit) as TaskEventRow[];
      return rows.map(rowToEvent);
    } catch (err) {
      getAppLogger().logError('TaskEventLog', 'getEvents failed', err);
      throw err;
    }
  }
}
