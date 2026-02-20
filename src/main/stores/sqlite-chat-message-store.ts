import type Database from 'better-sqlite3';
import type { ChatMessage, ChatMessageCreateInput } from '../../shared/types';
import type { IChatMessageStore } from '../interfaces/chat-message-store';
import { generateId, now } from './utils';

interface ChatMessageRow {
  id: string;
  project_id: string;
  role: string;
  content: string;
  created_at: number;
  cost_input_tokens: number | null;
  cost_output_tokens: number | null;
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    projectId: row.project_id,
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
    const id = generateId();
    const timestamp = now();

    this.db.prepare(
      'INSERT INTO chat_messages (id, project_id, role, content, created_at, cost_input_tokens, cost_output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, input.projectId, input.role, input.content, timestamp, input.costInputTokens ?? null, input.costOutputTokens ?? null);

    return {
      id,
      projectId: input.projectId,
      role: input.role,
      content: input.content,
      createdAt: timestamp,
      costInputTokens: input.costInputTokens ?? null,
      costOutputTokens: input.costOutputTokens ?? null,
    };
  }

  async getMessagesForProject(projectId: string): Promise<ChatMessage[]> {
    const rows = this.db.prepare(
      'SELECT * FROM chat_messages WHERE project_id = ? ORDER BY created_at ASC'
    ).all(projectId) as ChatMessageRow[];
    return rows.map(rowToMessage);
  }

  async clearMessages(projectId: string): Promise<void> {
    this.db.prepare('DELETE FROM chat_messages WHERE project_id = ?').run(projectId);
  }

  async replaceAllMessages(projectId: string, messages: ChatMessageCreateInput[]): Promise<ChatMessage[]> {
    const result: ChatMessage[] = [];

    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM chat_messages WHERE project_id = ?').run(projectId);

      const insert = this.db.prepare(
        'INSERT INTO chat_messages (id, project_id, role, content, created_at, cost_input_tokens, cost_output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      for (const msg of messages) {
        const id = generateId();
        const timestamp = now();
        insert.run(id, projectId, msg.role, msg.content, timestamp, msg.costInputTokens ?? null, msg.costOutputTokens ?? null);
        result.push({
          id,
          projectId,
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
  }

  async getCostSummary(): Promise<{ inputTokens: number; outputTokens: number }> {
    const row = this.db.prepare(
      'SELECT COALESCE(SUM(cost_input_tokens), 0) AS input_tokens, COALESCE(SUM(cost_output_tokens), 0) AS output_tokens FROM chat_messages'
    ).get() as { input_tokens: number; output_tokens: number };
    return { inputTokens: row.input_tokens, outputTokens: row.output_tokens };
  }
}
