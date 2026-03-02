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
  };
}

export class SqliteChatMessageStore implements IChatMessageStore {
  constructor(private db: Database.Database) {}

  async addMessage(input: ChatMessageCreateInput): Promise<ChatMessage> {
    try {
      const id = generateId();
      const timestamp = now();

      this.db.prepare(
        'INSERT INTO chat_messages (id, session_id, role, content, created_at, cost_input_tokens, cost_output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, input.sessionId, input.role, input.content, timestamp, input.costInputTokens ?? null, input.costOutputTokens ?? null);

      return {
        id,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        createdAt: timestamp,
        costInputTokens: input.costInputTokens ?? null,
        costOutputTokens: input.costOutputTokens ?? null,
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
          'INSERT INTO chat_messages (id, session_id, role, content, created_at, cost_input_tokens, cost_output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );

        for (const msg of messages) {
          const id = generateId();
          const timestamp = now();
          insert.run(id, sessionId, msg.role, msg.content, timestamp, msg.costInputTokens ?? null, msg.costOutputTokens ?? null);
          result.push({
            id,
            sessionId,
            role: msg.role,
            content: msg.content,
            createdAt: timestamp,
            costInputTokens: msg.costInputTokens ?? null,
            costOutputTokens: msg.costOutputTokens ?? null,
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

  async getCostSummary(): Promise<{ inputTokens: number; outputTokens: number }> {
    try {
      const row = this.db.prepare(
        'SELECT COALESCE(SUM(cost_input_tokens), 0) AS input_tokens, COALESCE(SUM(cost_output_tokens), 0) AS output_tokens FROM chat_messages'
      ).get() as { input_tokens: number; output_tokens: number };
      return { inputTokens: row.input_tokens, outputTokens: row.output_tokens };
    } catch (err) {
      getAppLogger().logError('ChatMessageStore', 'getCostSummary failed', err);
      throw err;
    }
  }
}
