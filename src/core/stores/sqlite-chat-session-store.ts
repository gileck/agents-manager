import type { IChatSessionStore, ChatSession, ChatSessionCreateInput, ChatSessionUpdateInput, ListSessionsOptions } from '../interfaces/chat-session-store';
import type { ChatScopeType, ChatSessionSource } from '../../shared/types';
import type Database from 'better-sqlite3';
import { generateId, now } from './utils';

type AppDatabase = Database.Database;

export class SqliteChatSessionStore implements IChatSessionStore {
  constructor(private db: AppDatabase) {}

  async createSession(input: ChatSessionCreateInput): Promise<ChatSession> {
    const source: ChatSessionSource = input.source ?? 'desktop';
    const session: ChatSession = {
      id: generateId(),
      projectId: input.projectId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      name: input.name,
      agentLib: input.agentLib ?? null,
      source,
      createdAt: now(),
      updatedAt: now(),
    };

    try {
      const stmt = this.db.prepare(`
        INSERT INTO chat_sessions (id, project_id, scope_type, scope_id, name, agent_lib, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(session.id, session.projectId, session.scopeType, session.scopeId, session.name, session.agentLib, session.source, session.createdAt, session.updatedAt);
      return session;
    } catch (error) {
      console.error('SqliteChatSessionStore.createSession failed:', error);
      throw new Error(`Failed to create chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getSession(id: string): Promise<ChatSession | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT id, project_id as projectId, scope_type as scopeType, scope_id as scopeId, name, agent_lib as agentLib, source, created_at as createdAt, updated_at as updatedAt
        FROM chat_sessions
        WHERE id = ?
      `);

      const row = stmt.get(id) as ChatSession | undefined;
      return row || null;
    } catch (error) {
      console.error('SqliteChatSessionStore.getSession failed:', error);
      throw new Error(`Failed to get chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listSessionsForScope(scopeType: ChatScopeType, scopeId: string, options?: ListSessionsOptions): Promise<ChatSession[]> {
    try {
      const params: unknown[] = [scopeType, scopeId];
      let sql = `
        SELECT id, project_id as projectId, scope_type as scopeType, scope_id as scopeId, name, agent_lib as agentLib, source, created_at as createdAt, updated_at as updatedAt
        FROM chat_sessions
        WHERE scope_type = ? AND scope_id = ?`;

      if (options?.excludeSources && options.excludeSources.length > 0) {
        const placeholders = options.excludeSources.map(() => '?').join(', ');
        sql += ` AND source NOT IN (${placeholders})`;
        params.push(...options.excludeSources);
      }

      sql += ` ORDER BY created_at ASC`;

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as ChatSession[];
      return rows;
    } catch (error) {
      console.error('SqliteChatSessionStore.listSessionsForScope failed:', error);
      throw new Error(`Failed to list chat sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async updateSession(id: string, input: ChatSessionUpdateInput): Promise<ChatSession | null> {
    try {
      const setClauses: string[] = [];
      const params: unknown[] = [];

      if (input.name !== undefined) {
        setClauses.push('name = ?');
        params.push(input.name);
      }
      if (input.agentLib !== undefined) {
        setClauses.push('agent_lib = ?');
        params.push(input.agentLib);
      }

      if (setClauses.length === 0) {
        return this.getSession(id);
      }

      setClauses.push('updated_at = ?');
      params.push(now());
      params.push(id);

      const stmt = this.db.prepare(`
        UPDATE chat_sessions
        SET ${setClauses.join(', ')}
        WHERE id = ?
      `);

      const result = stmt.run(...params);

      if (result.changes === 0) {
        return null;
      }

      return this.getSession(id);
    } catch (error) {
      console.error('SqliteChatSessionStore.updateSession failed:', error);
      throw new Error(`Failed to update chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM chat_sessions
        WHERE id = ?
      `);

      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error) {
      console.error('SqliteChatSessionStore.deleteSession failed:', error);
      throw new Error(`Failed to delete chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
