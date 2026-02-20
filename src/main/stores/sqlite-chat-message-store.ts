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
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    projectId: row.project_id,
    role: row.role as ChatMessage['role'],
    content: row.content,
    createdAt: row.created_at,
  };
}

export class SqliteChatMessageStore implements IChatMessageStore {
  constructor(private db: Database.Database) {}

  async addMessage(input: ChatMessageCreateInput): Promise<ChatMessage> {
    const id = generateId();
    const timestamp = now();

    this.db.prepare(
      'INSERT INTO chat_messages (id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, input.projectId, input.role, input.content, timestamp);

    return {
      id,
      projectId: input.projectId,
      role: input.role,
      content: input.content,
      createdAt: timestamp,
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
        'INSERT INTO chat_messages (id, project_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)'
      );

      for (const msg of messages) {
        const id = generateId();
        const timestamp = now();
        insert.run(id, projectId, msg.role, msg.content, timestamp);
        result.push({
          id,
          projectId,
          role: msg.role,
          content: msg.content,
          createdAt: timestamp,
        });
      }
    });

    txn();
    return result;
  }
}
