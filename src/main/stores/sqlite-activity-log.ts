import type Database from 'better-sqlite3';
import type { ActivityEntry, ActivityCreateInput, ActivityFilter } from '../../shared/types';
import type { IActivityLog } from '../interfaces/activity-log';
import { generateId, now, parseJson } from './utils';

interface ActivityRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  data: string;
  created_at: number;
}

function rowToEntry(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    action: row.action as ActivityEntry['action'],
    entityType: row.entity_type as ActivityEntry['entityType'],
    entityId: row.entity_id,
    summary: row.summary,
    data: parseJson<Record<string, unknown>>(row.data, {}),
    createdAt: row.created_at,
  };
}

export class SqliteActivityLog implements IActivityLog {
  constructor(private db: Database.Database) {}

  async log(input: ActivityCreateInput): Promise<ActivityEntry> {
    const id = generateId();
    const timestamp = now();

    this.db.prepare(`
      INSERT INTO activity_log (id, action, entity_type, entity_id, summary, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.action,
      input.entityType,
      input.entityId,
      input.summary,
      JSON.stringify(input.data ?? {}),
      timestamp,
    );

    return {
      id,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: input.summary,
      data: input.data ?? {},
      createdAt: timestamp,
    };
  }

  async getEntries(filter?: ActivityFilter): Promise<ActivityEntry[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.action) {
      conditions.push('action = ?');
      values.push(filter.action);
    }
    if (filter?.entityType) {
      conditions.push('entity_type = ?');
      values.push(filter.entityType);
    }
    if (filter?.entityId) {
      conditions.push('entity_id = ?');
      values.push(filter.entityId);
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
    const rows = this.db.prepare(`SELECT * FROM activity_log ${where} ORDER BY created_at ASC`).all(...values) as ActivityRow[];
    return rows.map(rowToEntry);
  }
}
