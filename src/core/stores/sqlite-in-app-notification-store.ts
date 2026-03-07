import type Database from 'better-sqlite3';
import type { InAppNotification, InAppNotificationCreateInput, InAppNotificationFilter } from '../../shared/types';
import type { IInAppNotificationStore } from '../interfaces/in-app-notification-store';
import { generateId, now } from './utils';

interface AppNotificationRow {
  id: string;
  task_id: string;
  project_id: string | null;
  title: string;
  body: string;
  navigation_url: string;
  read: number;
  created_at: number;
}

function rowToNotification(row: AppNotificationRow): InAppNotification {
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    navigationUrl: row.navigation_url,
    read: row.read === 1,
    createdAt: row.created_at,
  };
}

export class SqliteInAppNotificationStore implements IInAppNotificationStore {
  constructor(private db: Database.Database) {}

  async add(input: InAppNotificationCreateInput): Promise<InAppNotification> {
    const id = generateId();
    const createdAt = now();

    this.db.prepare(`
      INSERT INTO app_notifications (id, task_id, project_id, title, body, navigation_url, read, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, input.taskId, input.projectId ?? null, input.title, input.body, input.navigationUrl, createdAt);

    const row = this.db.prepare('SELECT * FROM app_notifications WHERE id = ?').get(id) as AppNotificationRow;
    return rowToNotification(row);
  }

  async list(filter?: InAppNotificationFilter): Promise<InAppNotification[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.projectId) {
      conditions.push('project_id = ?');
      values.push(filter.projectId);
    }
    if (filter?.unreadOnly) {
      conditions.push('read = 0');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit ?? 50;
    const rows = this.db.prepare(
      `SELECT * FROM app_notifications ${where} ORDER BY created_at DESC LIMIT ?`,
    ).all(...values, limit) as AppNotificationRow[];

    return rows.map(rowToNotification);
  }

  async markRead(id: string): Promise<void> {
    this.db.prepare('UPDATE app_notifications SET read = 1 WHERE id = ?').run(id);
  }

  async markAllRead(projectId?: string): Promise<void> {
    if (projectId) {
      this.db.prepare('UPDATE app_notifications SET read = 1 WHERE project_id = ?').run(projectId);
    } else {
      this.db.prepare('UPDATE app_notifications SET read = 1').run();
    }
  }

  async getUnreadCount(projectId?: string): Promise<number> {
    let row: { cnt: number };
    if (projectId) {
      row = this.db.prepare('SELECT COUNT(*) AS cnt FROM app_notifications WHERE read = 0 AND project_id = ?').get(projectId) as { cnt: number };
    } else {
      row = this.db.prepare('SELECT COUNT(*) AS cnt FROM app_notifications WHERE read = 0').get() as { cnt: number };
    }
    return row.cnt;
  }
}
