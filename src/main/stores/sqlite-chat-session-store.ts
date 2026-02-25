import type { IChatSessionStore, ChatSession, ChatSessionCreateInput, ChatSessionUpdateInput } from '../interfaces/chat-session-store';
import type Database from 'better-sqlite3';
import { generateId, now } from './utils';

type AppDatabase = Database.Database;

export class SqliteChatSessionStore implements IChatSessionStore {
  constructor(private db: AppDatabase) {}

  async createSession(input: ChatSessionCreateInput): Promise<ChatSession> {
    const session: ChatSession = {
      id: generateId(),
      projectId: input.projectId,
      name: input.name,
      createdAt: now(),
      updatedAt: now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO project_chat_sessions (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(session.id, session.projectId, session.name, session.createdAt, session.updatedAt);
    return session;
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const stmt = this.db.prepare(`
      SELECT id, project_id as projectId, name, created_at as createdAt, updated_at as updatedAt
      FROM project_chat_sessions
      WHERE id = ?
    `);

    const row = stmt.get(id) as ChatSession | undefined;
    return row || null;
  }

  async listSessionsForProject(projectId: string): Promise<ChatSession[]> {
    const stmt = this.db.prepare(`
      SELECT id, project_id as projectId, name, created_at as createdAt, updated_at as updatedAt
      FROM project_chat_sessions
      WHERE project_id = ?
      ORDER BY created_at ASC
    `);

    const rows = stmt.all(projectId) as ChatSession[];
    return rows;
  }

  async updateSession(id: string, input: ChatSessionUpdateInput): Promise<ChatSession | null> {
    const stmt = this.db.prepare(`
      UPDATE project_chat_sessions
      SET name = ?, updated_at = ?
      WHERE id = ?
    `);

    const result = stmt.run(input.name, now(), id);

    if (result.changes === 0) {
      return null;
    }

    return this.getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    const stmt = this.db.prepare(`
      DELETE FROM project_chat_sessions
      WHERE id = ?
    `);

    const result = stmt.run(id);
    return result.changes > 0;
  }
}