import type { IChatSessionStore, ChatSession, ChatSessionCreateInput, ChatSessionUpdateInput, ListSessionsOptions } from '../interfaces/chat-session-store';
import type { ChatScopeType, ChatSessionSource, ChatSessionWithDetails, TaskChatSessionWithTitle } from '../../shared/types';
import type Database from 'better-sqlite3';
import { generateId, now } from './utils';
import { getAppLogger } from '../services/app-logger';

type AppDatabase = Database.Database;

// SQLite stores booleans as 0/1 integers; coerce to boolean after reading.
type RawRow = Record<string, unknown>;
function toSession(row: RawRow): ChatSession {
  return {
    ...(row as Omit<ChatSession, 'sidebarHidden' | 'enableStreaming' | 'enableStreamingInput'>),
    sidebarHidden: row.sidebarHidden === 1,
    enableStreaming: row.enableStreaming !== 0,
    enableStreamingInput: row.enableStreamingInput === 1,
  } as ChatSession;
}
function toSessionWithDetails(row: RawRow): ChatSessionWithDetails {
  return {
    ...toSession(row),
    messageCount: (row.messageCount as number) ?? 0,
    taskTitle: (row.taskTitle as string | undefined) ?? undefined,
  };
}
function toTaskSession(row: RawRow): TaskChatSessionWithTitle {
  return {
    ...toSession(row),
    scopeType: 'task',
    taskTitle: row.taskTitle as string,
    taskStatus: row.taskStatus as string,
  };
}

const SESSION_SELECT = `id, project_id as projectId, scope_type as scopeType, scope_id as scopeId, name, agent_lib as agentLib, model, source, agent_role as agentRole, agent_run_id as agentRunId, permission_mode as permissionMode, sidebar_hidden as sidebarHidden, system_prompt_append as systemPromptAppend, enable_streaming as enableStreaming, enable_streaming_input as enableStreamingInput, draft, status, created_at as createdAt, updated_at as updatedAt`;

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
      sidebarHidden: false,
      systemPromptAppend: null,
      enableStreaming: input.enableStreaming ?? true,
      enableStreamingInput: input.enableStreamingInput ?? false,
      draft: null,
      status: 'idle',
      createdAt: now(),
      updatedAt: now(),
    };

    try {
      const stmt = this.db.prepare(`
        INSERT INTO chat_sessions (id, project_id, scope_type, scope_id, name, agent_lib, model, source, agent_role, permission_mode, enable_streaming, enable_streaming_input, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(session.id, session.projectId, session.scopeType, session.scopeId, session.name, session.agentLib, session.model, session.source, session.agentRole, session.permissionMode, session.enableStreaming ? 1 : 0, session.enableStreamingInput ? 1 : 0, session.createdAt, session.updatedAt);
      return session;
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'createSession failed', error);
      throw new Error(`Failed to create chat session: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async getSession(id: string): Promise<ChatSession | null> {
    try {
      const stmt = this.db.prepare(`
        SELECT ${SESSION_SELECT}
        FROM chat_sessions
        WHERE id = ?
      `);

      const row = stmt.get(id) as RawRow | undefined;
      return row ? toSession(row) : null;
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'getSession failed', error);
      throw new Error(`Failed to get chat session: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async listSessionsForScope(scopeType: ChatScopeType, scopeId: string, options?: ListSessionsOptions): Promise<ChatSession[]> {
    try {
      const params: unknown[] = [scopeType, scopeId];
      let sql = `
        SELECT ${SESSION_SELECT}
        FROM chat_sessions
        WHERE scope_type = ? AND scope_id = ? AND sidebar_hidden = 0`;

      if (options?.excludeSources && options.excludeSources.length > 0) {
        const placeholders = options.excludeSources.map(() => '?').join(', ');
        sql += ` AND source NOT IN (${placeholders})`;
        params.push(...options.excludeSources);
      }

      sql += ` ORDER BY created_at ASC`;

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as RawRow[];
      return rows.map(toSession);
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'listSessionsForScope failed', error);
      throw new Error(`Failed to list chat sessions: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async listTaskSessionsForProject(projectId: string, options?: ListSessionsOptions): Promise<TaskChatSessionWithTitle[]> {
    try {
      const params: unknown[] = [projectId];
      let sql = `
        SELECT cs.id, cs.project_id as projectId, cs.scope_type as scopeType, cs.scope_id as scopeId,
               cs.name, cs.agent_lib as agentLib, cs.model, cs.source, cs.agent_role as agentRole, cs.agent_run_id as agentRunId, cs.permission_mode as permissionMode, cs.sidebar_hidden as sidebarHidden, cs.system_prompt_append as systemPromptAppend, cs.enable_streaming as enableStreaming, cs.enable_streaming_input as enableStreamingInput, cs.draft, cs.status, cs.created_at as createdAt, cs.updated_at as updatedAt,
               t.title as taskTitle, t.status as taskStatus
        FROM chat_sessions cs
        JOIN tasks t ON cs.scope_id = t.id
        WHERE cs.project_id = ? AND cs.scope_type = 'task' AND cs.sidebar_hidden = 0
          AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.session_id = cs.id)`;

      if (options?.excludeSources && options.excludeSources.length > 0) {
        const placeholders = options.excludeSources.map(() => '?').join(', ');
        sql += ` AND cs.source NOT IN (${placeholders})`;
        params.push(...options.excludeSources);
      }

      sql += ` ORDER BY cs.updated_at DESC`;

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(...params) as RawRow[];
      return rows.map(toTaskSession);
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'listTaskSessionsForProject failed', error);
      throw new Error(`Failed to list task chat sessions: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async listAllForProject(projectId: string): Promise<ChatSessionWithDetails[]> {
    try {
      const sql = `
        SELECT cs.id, cs.project_id as projectId, cs.scope_type as scopeType, cs.scope_id as scopeId,
               cs.name, cs.agent_lib as agentLib, cs.model, cs.source, cs.agent_role as agentRole, cs.agent_run_id as agentRunId, cs.permission_mode as permissionMode, cs.sidebar_hidden as sidebarHidden, cs.system_prompt_append as systemPromptAppend, cs.enable_streaming as enableStreaming, cs.enable_streaming_input as enableStreamingInput, cs.draft, cs.status, cs.created_at as createdAt, cs.updated_at as updatedAt,
               COALESCE((SELECT COUNT(*) FROM chat_messages cm WHERE cm.session_id = cs.id), 0) as messageCount
        FROM chat_sessions cs
        WHERE cs.project_id = ? AND cs.scope_type = 'project'
        ORDER BY cs.updated_at DESC`;

      const stmt = this.db.prepare(sql);
      const rows = stmt.all(projectId) as RawRow[];
      return rows.map(toSessionWithDetails);
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'listAllForProject failed', error);
      throw new Error(`Failed to list all chat sessions: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
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
      if (input.systemPromptAppend !== undefined) {
        setClauses.push('system_prompt_append = ?');
        params.push(input.systemPromptAppend);
      }
      if (input.enableStreaming !== undefined) {
        setClauses.push('enable_streaming = ?');
        params.push(input.enableStreaming ? 1 : 0);
      }
      if (input.enableStreamingInput !== undefined) {
        setClauses.push('enable_streaming_input = ?');
        params.push(input.enableStreamingInput ? 1 : 0);
      }
      if (input.draft !== undefined) {
        setClauses.push('draft = ?');
        params.push(input.draft);
      }
      if (input.status !== undefined) {
        setClauses.push('status = ?');
        params.push(input.status);
      }

      if (setClauses.length === 0) {
        return this.getSession(id);
      }

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
      throw new Error(`Failed to update chat session: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
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
      throw new Error(`Failed to delete chat session: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async hideSession(id: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare(`
        UPDATE chat_sessions SET sidebar_hidden = 1 WHERE id = ?
      `);
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'hideSession failed', error);
      throw new Error(`Failed to hide chat session: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async unhideSession(id: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare(`
        UPDATE chat_sessions SET sidebar_hidden = 0 WHERE id = ?
      `);
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'unhideSession failed', error);
      throw new Error(`Failed to unhide chat session: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async hideAllSessions(projectId: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare(`
        UPDATE chat_sessions SET sidebar_hidden = 1 WHERE project_id = ?
      `);
      const result = stmt.run(projectId);
      return result.changes > 0;
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'hideAllSessions failed', error);
      throw new Error(`Failed to hide all chat sessions: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async addTrackedTask(sessionId: string, taskId: string): Promise<void> {
    try {
      const row = this.db.prepare(`SELECT task_ids FROM chat_sessions WHERE id = ?`).get(sessionId) as { task_ids: string } | undefined;
      if (!row) return;
      const ids: string[] = JSON.parse(row.task_ids || '[]');
      if (!ids.includes(taskId)) {
        ids.push(taskId);
        this.db.prepare(`UPDATE chat_sessions SET task_ids = ? WHERE id = ?`).run(JSON.stringify(ids), sessionId);
      }
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'addTrackedTask failed', error);
      throw new Error(`Failed to add tracked task: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async removeTrackedTask(sessionId: string, taskId: string): Promise<void> {
    try {
      const row = this.db.prepare(`SELECT task_ids FROM chat_sessions WHERE id = ?`).get(sessionId) as { task_ids: string } | undefined;
      if (!row) return;
      const ids: string[] = JSON.parse(row.task_ids || '[]');
      const filtered = ids.filter((id) => id !== taskId);
      this.db.prepare(`UPDATE chat_sessions SET task_ids = ? WHERE id = ?`).run(JSON.stringify(filtered), sessionId);
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'removeTrackedTask failed', error);
      throw new Error(`Failed to remove tracked task: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async getTrackedTaskIds(sessionId: string): Promise<string[]> {
    try {
      const row = this.db.prepare(`SELECT task_ids FROM chat_sessions WHERE id = ?`).get(sessionId) as { task_ids: string } | undefined;
      if (!row) return [];
      return JSON.parse(row.task_ids || '[]');
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'getTrackedTaskIds failed', error);
      throw new Error(`Failed to get tracked task IDs: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  async updateSessionStatus(id: string, status: import('../../shared/types').ChatSessionStatus): Promise<void> {
    try {
      this.db.prepare(`UPDATE chat_sessions SET status = ? WHERE id = ?`).run(status, id);
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'updateSessionStatus failed', error);
    }
  }

  async resetStaleStatuses(): Promise<void> {
    try {
      const result = this.db.prepare(`UPDATE chat_sessions SET status = 'idle' WHERE status IN ('running', 'waiting_for_input', 'error')`).run();
      if (result.changes > 0) {
        getAppLogger().info('ChatSessionStore', `Reset ${result.changes} stale session(s) to idle`);
      }
    } catch (error) {
      getAppLogger().logError('ChatSessionStore', 'resetStaleStatuses failed', error);
    }
  }
}
