import type { IChatSessionStore, ChatSession, ChatSessionCreateInput, ChatSessionUpdateInput, ListSessionsOptions } from '../interfaces/chat-session-store';
import type { ChatScopeType, ChatSessionSource, TaskChatSessionWithTitle } from '../../shared/types';
import type Database from 'better-sqlite3';
import { generateId, now } from './utils';
import { getAppLogger } from '../services/app-logger';

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
      model: input.model ?? null,
      source,
      agentRole: input.agentRole ?? null,
      agentRunId: null,
      permissionMode: input.permissionMode ?? null,
      createdAt: now(),
      updatedAt: now(),
    };

    try {
      const stmt = this.db.prepare(`
        INSERT INTO chat_sessions (id, project_id, scope_type, scope_id, name, agent_lib, model, source, agent_role, permission_mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(session.id, session.projectId, session.scopeType, session.scopeId, session.name, session.agentLib, session.model, session.source, session.agentRole, session.permissionMode, session.createdAt, session.updatedAt);
      return session;
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'createSession failed', error);
      throw new Error(`Failed to create chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async getSession(id: string): Promise<ChatSession | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT id, project_id as projectId, scope_type as scopeType, scope_id as scopeId, name, agent_lib as agentLib, model, source, agent_role as agentRole, agent_run_id as agentRunId, permission_mode as permissionMode, created_at as createdAt, updated_at as updatedAt
        FROM chat_sessions
        WHERE id = ?
      `);

      const row = stmt.get(id) as ChatSession | undefined;
      return row || null;
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'getSession failed', error);
      throw new Error(`Failed to get chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listSessionsForScope(scopeType: ChatScopeType, scopeId: string, options?: ListSessionsOptions): Promise<ChatSession[]> {
    try {
      const params: unknown[] = [scopeType, scopeId];
      let sql = `
        SELECT id, project_id as projectId, scope_type as scopeType, scope_id as scopeId, name, agent_lib as agentLib, model, source, agent_role as agentRole, agent_run_id as agentRunId, permission_mode as permissionMode, created_at as createdAt, updated_at as updatedAt
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
      getAppLogger().logError('ChatSessionStore', 'listSessionsForScope failed', error);
      throw new Error(`Failed to list chat sessions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async listTaskSessionsForProject(projectId: string, options?: ListSessionsOptions): Promise<TaskChatSessionWithTitle[]> {
    try {
      const params: unknown[] = [projectId];
      let sql = `
        SELECT cs.id, cs.project_id as projectId, cs.scope_type as scopeType, cs.scope_id as scopeId,
               cs.name, cs.agent_lib as agentLib, cs.model, cs.source, cs.agent_role as agentRole, cs.agent_run_id as agentRunId, cs.permission_mode as permissionMode, cs.created_at as createdAt, cs.updated_at as updatedAt,
               t.title as taskTitle, t.status as taskStatus
        FROM chat_sessions cs
        JOIN tasks t ON cs.scope_id = t.id
        WHERE cs.project_id = ? AND cs.scope_type = 'task'
          AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.session_id = cs.id)`;

      if (options?.excludeSources && options.excludeSources.length > 0) {
        const placeholders = options.excludeSources.map(() => '?').join(', ');
        sql += ` AND cs.source NOT IN (${placeholders})`;
        params.push(...options.excludeSources);
      }

      sql += ` ORDER BY cs.updated_at DESC`;

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as TaskChatSessionWithTitle[];
      return rows;
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'listTaskSessionsForProject failed', error);
      throw new Error(`Failed to list task chat sessions: ${error instanceof Error ? error.message : String(error)}`);
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
      if (input.model !== undefined) {
        setClauses.push('model = ?');
        params.push(input.model);
      }
      if (input.agentRunId !== undefined) {
        setClauses.push('agent_run_id = ?');
        params.push(input.agentRunId);
      }
      if (input.permissionMode !== undefined) {
        setClauses.push('permission_mode = ?');
        params.push(input.permissionMode);
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
      getAppLogger().logError('ChatSessionStore', 'updateSession failed', error);
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
      getAppLogger().logError('ChatSessionStore', 'deleteSession failed', error);
      throw new Error(`Failed to delete chat session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
