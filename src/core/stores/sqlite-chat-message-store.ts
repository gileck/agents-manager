import type Database from 'better-sqlite3';
import type { ChatMessage, ChatMessageCreateInput } from '../../shared/types';
import type { IChatMessageStore } from '../interfaces/chat-message-store';
import { generateId, now } from './utils';
import { getAppLogger } from '../services/app-logger';

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: number;
  cost_input_tokens: number | null;
  cost_output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  total_cost_usd: number | null;
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as ChatMessage['role'],
    content: row.content,
    createdAt: row.created_at,
    costInputTokens: row.cost_input_tokens,
    costOutputTokens: row.cost_output_tokens,
    cacheReadInputTokens: row.cache_read_input_tokens ?? null,
    cacheCreationInputTokens: row.cache_creation_input_tokens ?? null,
    totalCostUsd: row.total_cost_usd ?? null,
  };
}

export class SqliteChatMessageStore implements IChatMessageStore {
  constructor(private db: Database.Database) {}

  async addMessage(input: ChatMessageCreateInput): Promise<ChatMessage> {
    try {
      const id = generateId();
      const timestamp = now();

      this.db.prepare(
        'INSERT INTO chat_messages (id, session_id, role, content, created_at, cost_input_tokens, cost_output_tokens, cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, input.sessionId, input.role, input.content, timestamp, input.costInputTokens ?? null, input.costOutputTokens ?? null, input.cacheReadInputTokens ?? null, input.cacheCreationInputTokens ?? null, input.totalCostUsd ?? null);

      this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(timestamp, input.sessionId);

      return {
        id,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        createdAt: timestamp,
        costInputTokens: input.costInputTokens ?? null,
        costOutputTokens: input.costOutputTokens ?? null,
        cacheReadInputTokens: input.cacheReadInputTokens ?? null,
        cacheCreationInputTokens: input.cacheCreationInputTokens ?? null,
        totalCostUsd: input.totalCostUsd ?? null,
      };
    } catch (err) {
      getAppLogger().logError('ChatMessageStore', 'addMessage failed', err);
      throw err;
    }
  }

  async getMessagesForSession(sessionId: string, limit: number = 5000): Promise<ChatMessage[]> {
    try {
      const rows = this.db.prepare(
        'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?'
      ).all(sessionId, limit) as ChatMessageRow[];
      return rows.map(rowToMessage);
    } catch (err) {
      getAppLogger().logError('ChatMessageStore', 'getMessagesForSession failed', err);
      throw err;
    }
  }

  async clearMessages(sessionId: string): Promise<void> {
    try {
      this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
    } catch (err) {
      getAppLogger().logError('ChatMessageStore', 'clearMessages failed', err);
      throw err;
    }
  }

  async replaceAllMessages(sessionId: string, messages: ChatMessageCreateInput[]): Promise<ChatMessage[]> {
    try {
      const result: ChatMessage[] = [];

      const txn = this.db.transaction(() => {
        this.db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);

        const insert = this.db.prepare(
          'INSERT INTO chat_messages (id, session_id, role, content, created_at, cost_input_tokens, cost_output_tokens, cache_read_input_tokens, cache_creation_input_tokens, total_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );

        for (const msg of messages) {
          const id = generateId();
          const timestamp = now();
          insert.run(id, sessionId, msg.role, msg.content, timestamp, msg.costInputTokens ?? null, msg.costOutputTokens ?? null, msg.cacheReadInputTokens ?? null, msg.cacheCreationInputTokens ?? null, msg.totalCostUsd ?? null);
          result.push({
            id,
            sessionId,
            role: msg.role,
            content: msg.content,
            createdAt: timestamp,
            costInputTokens: msg.costInputTokens ?? null,
            costOutputTokens: msg.costOutputTokens ?? null,
            cacheReadInputTokens: msg.cacheReadInputTokens ?? null,
            cacheCreationInputTokens: msg.cacheCreationInputTokens ?? null,
            totalCostUsd: msg.totalCostUsd ?? null,
          });
        }
      });

      txn();
      return result;
    } catch (err) {
      getAppLogger().logError('ChatMessageStore', 'replaceAllMessages failed', err);
      throw err;
    }
  }

  async getCostSummary(): Promise<{ inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; totalCostUsd: number }> {
    try {
      const row = this.db.prepare(
        `SELECT COALESCE(SUM(cost_input_tokens), 0) AS input_tokens,
                COALESCE(SUM(cost_output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_input_tokens), 0) AS cache_read_input_tokens,
                COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
                COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd
         FROM chat_messages`
      ).get() as { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number; total_cost_usd: number };
      return {
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cacheReadInputTokens: row.cache_read_input_tokens,
        cacheCreationInputTokens: row.cache_creation_input_tokens,
        totalCostUsd: row.total_cost_usd,
      };
    } catch (err) {
      getAppLogger().logError('ChatMessageStore', 'getCostSummary failed', err);
      throw err;
    }
  }
}
