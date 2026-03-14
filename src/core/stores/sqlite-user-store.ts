import type Database from 'better-sqlite3';
import type { User, UserRole } from '../../shared/types';
import type { IUserStore } from '../interfaces/user-store';
import { generateId, now } from './utils';
import { getAppLogger } from '../services/app-logger';

interface UserRow {
  id: string;
  username: string;
  role: string;
  created_at: number;
  updated_at: number;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserRole,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteUserStore implements IUserStore {
  constructor(private db: Database.Database) {}

  async getUser(id: string): Promise<User | null> {
    try {
      const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
      return row ? rowToUser(row) : null;
    } catch (err) {
      getAppLogger().logError('UserStore', 'getUser failed', err);
      throw err;
    }
  }

  async getUserByUsername(username: string): Promise<User | null> {
    try {
      const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
      return row ? rowToUser(row) : null;
    } catch (err) {
      getAppLogger().logError('UserStore', 'getUserByUsername failed', err);
      throw err;
    }
  }

  async listUsers(): Promise<User[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as UserRow[];
      return rows.map(rowToUser);
    } catch (err) {
      getAppLogger().logError('UserStore', 'listUsers failed', err);
      throw err;
    }
  }

  async createUser(username: string, role: UserRole): Promise<User> {
    try {
      const id = `user-${generateId()}`;
      const timestamp = now();

      this.db.prepare(`
        INSERT INTO users (id, username, role, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, username, role, timestamp, timestamp);

      return (await this.getUser(id))!;
    } catch (err) {
      getAppLogger().logError('UserStore', 'createUser failed', err);
      throw err;
    }
  }

  async updateUserRole(id: string, role: UserRole): Promise<User | null> {
    try {
      const existing = await this.getUser(id);
      if (!existing) return null;

      const timestamp = now();
      this.db.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`).run(role, timestamp, id);

      return (await this.getUser(id))!;
    } catch (err) {
      getAppLogger().logError('UserStore', 'updateUserRole failed', err);
      throw err;
    }
  }

  async deleteUser(id: string): Promise<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (err) {
      getAppLogger().logError('UserStore', 'deleteUser failed', err);
      throw err;
    }
  }

  getUserRoleSync(_username: string): 'admin' | 'user' | null {
    throw new Error('Not implemented');
  }
}
