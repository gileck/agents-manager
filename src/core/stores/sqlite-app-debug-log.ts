import type Database from 'better-sqlite3';
import type { AppDebugLogEntry, AppDebugLogCreateInput, AppDebugLogFilter } from '../../shared/types';
import type { IAppDebugLog } from '../interfaces/app-debug-log';
import { generateId, now, parseJson } from './utils';

const MAX_ROWS = 10_000;

interface AppDebugLogRow {
  id: string;
  level: string;
  source: string;
  message: string;
  data: string;
  created_at: number;
}

function rowToEntry(row: AppDebugLogRow): AppDebugLogEntry {
  return {
    id: row.id,
    level: row.level as AppDebugLogEntry['level'],
    source: row.source,
    message: row.message,
    data: parseJson<Record<string, unknown>>(row.data, {}),
    createdAt: row.created_at,
  };
}

export class SqliteAppDebugLog implements IAppDebugLog {
  constructor(private db: Database.Database) {}

  log(input: AppDebugLogCreateInput): void {
    try {
      const id = generateId();
      const timestamp = now();

      this.db.prepare(`
        INSERT INTO app_debug_log (id, level, source, message, data, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.level,
        input.source,
        input.message,
        JSON.stringify(input.data ?? {}),
        timestamp,
      );

      // Auto-prune when exceeding max rows
      const countRow = this.db.prepare('SELECT COUNT(*) AS cnt FROM app_debug_log').get() as { cnt: number };
      if (countRow.cnt > MAX_ROWS) {
        this.db.prepare(`
          DELETE FROM app_debug_log WHERE id IN (
            SELECT id FROM app_debug_log ORDER BY created_at ASC LIMIT ?
          )
        `).run(countRow.cnt - MAX_ROWS);
      }
    } catch (err) {
      // fire-and-forget — never throws, but surface failures via stderr
      console.error('[AppDebugLog] Failed to write log entry:', err);
    }
  }

  async getEntries(filter?: AppDebugLogFilter): Promise<AppDebugLogEntry[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.level) {
      conditions.push('level = ?');
      values.push(filter.level);
    }
    if (filter?.source) {
      conditions.push('source = ?');
      values.push(filter.source);
    }
    if (filter?.search) {
      conditions.push('message LIKE ?');
      values.push(`%${filter.search}%`);
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
    const limit = filter?.limit ?? 500;
    const rows = this.db.prepare(
      `SELECT * FROM app_debug_log ${where} ORDER BY created_at DESC LIMIT ?`,
    ).all(...values, limit) as AppDebugLogRow[];
    return rows.map(rowToEntry);
  }

  async clear(olderThanMs?: number): Promise<number> {
    if (olderThanMs !== undefined) {
      const cutoff = now() - olderThanMs;
      const result = this.db.prepare('DELETE FROM app_debug_log WHERE created_at < ?').run(cutoff);
      return result.changes;
    }
    const result = this.db.prepare('DELETE FROM app_debug_log').run();
    return result.changes;
  }
}
