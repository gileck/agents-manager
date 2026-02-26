import type { IChatSessionStore, ChatSession, ChatSessionCreateInput, ChatSessionUpdateInput } from '../interfaces/chat-session-store';
import type { ChatScopeType } from '../../shared/types';
import type Database from 'better-sqlite3';
import { generateId, now } from './utils';

type AppDatabase = Database.Database;

export class SqliteChatSessionStore implements IChatSessionStore {
  constructor(private db: AppDatabase) {}

  async createSession(input: ChatSessionCreateInput): Promise<ChatSession> {
    const session: ChatSession = {
      id: generateId(),
      projectId: input.scopeType === 'project' ? input.scopeId : '',
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      name: input.name,
      createdAt: now(),
      updatedAt: now(),
    };

    try {
      const stmt = this.db.prepare(`
        INSERT INTO project_chat_sessions (id, project_id, scope_type, scope_id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(session.id, session.projectId, session.scopeType, session.scopeId, session.name, session.createdAt, session.updatedAt);
      return session;
    } catch (error) {
      throw new Error(`Failed to create chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getSession(id: string): Promise<ChatSession | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT id, project_id as projectId, scope_type as scopeType, scope_id as scopeId, name, created_at as createdAt, updated_at as updatedAt
        FROM project_chat_sessions
        WHERE id = ?
      `);

      const row = stmt.get(id) as ChatSession | undefined;
      return row || null;
    } catch (error) {
      throw new Error(`Failed to get chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listSessionsForScope(scopeType: ChatScopeType, scopeId: string): Promise<ChatSession[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT id, project_id as projectId, scope_type as scopeType, scope_id as scopeId, name, created_at as createdAt, updated_at as updatedAt
        FROM project_chat_sessions
        WHERE scope_type = ? AND scope_id = ?
        ORDER BY created_at ASC
      `);

      const rows = stmt.all(scopeType, scopeId) as ChatSession[];
      return rows;
    } catch (error) {
      throw new Error(`Failed to list chat sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async updateSession(id: string, input: ChatSessionUpdateInput): Promise<ChatSession | null> {
    try {
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
    } catch (error) {
      throw new Error(`Failed to update chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM project_chat_sessions
        WHERE id = ?
      `);

      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error) {
      throw new Error(`Failed to delete chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
