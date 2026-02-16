import type Database from 'better-sqlite3';
import type { TaskEvent, TaskEventCreateInput, TaskEventFilter } from '../../shared/types';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import { generateId, now, parseJson } from './utils';

interface TaskEventRow {
  id: string;
  task_id: string;
  category: string;
  severity: string;
  message: string;
  data: string;
  created_at: number;
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
  };
}

export class SqliteTaskEventLog implements ITaskEventLog {
  constructor(private db: Database.Database) {}

  log(input: TaskEventCreateInput): TaskEvent {
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
  }

  getEvents(filter?: TaskEventFilter): TaskEvent[] {
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
    const rows = this.db.prepare(`SELECT * FROM task_events ${where} ORDER BY created_at ASC`).all(...values) as TaskEventRow[];
    return rows.map(rowToEvent);
  }
}
