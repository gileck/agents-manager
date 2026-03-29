import type Database from 'better-sqlite3';
import type { TerminalSession, TerminalCreateInput } from '../../shared/types';
import type { ITerminalStore } from '../interfaces/terminal-store';
import { generateId, now } from './utils';

interface TerminalRow {
  id: string;
  project_id: string;
  name: string;
  cwd: string;
  type: 'blank' | 'claude';
  claude_session_id: string | null;
  created_at: number;
}

function rowToTerminal(row: TerminalRow): TerminalSession {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    cwd: row.cwd,
    type: row.type,
    claudeSessionId: row.claude_session_id,
    status: 'exited',
    exitCode: null,
    createdAt: row.created_at,
  };
}

export class SqliteTerminalStore implements ITerminalStore {
  constructor(private db: Database.Database) {}

  async getTerminal(id: string): Promise<TerminalSession | null> {
    const row = this.db.prepare('SELECT * FROM terminals WHERE id = ?').get(id) as TerminalRow | undefined;
    return row ? rowToTerminal(row) : null;
  }

  async listTerminals(projectId?: string): Promise<TerminalSession[]> {
    if (projectId) {
      const rows = this.db.prepare('SELECT * FROM terminals WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as TerminalRow[];
      return rows.map(rowToTerminal);
    }
    const rows = this.db.prepare('SELECT * FROM terminals ORDER BY created_at DESC').all() as TerminalRow[];
    return rows.map(rowToTerminal);
  }

  async createTerminal(input: TerminalCreateInput & { id?: string; claudeSessionId?: string }): Promise<TerminalSession> {
    const id = input.id ?? generateId();
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO terminals (id, project_id, name, cwd, type, claude_session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.projectId, input.name, input.cwd, input.type, input.claudeSessionId ?? null, timestamp);
    return (await this.getTerminal(id))!;
  }

  async updateClaudeSessionId(id: string, claudeSessionId: string): Promise<void> {
    this.db.prepare('UPDATE terminals SET claude_session_id = ? WHERE id = ?').run(claudeSessionId, id);
  }

  async deleteTerminal(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM terminals WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async deleteAllForProject(projectId: string): Promise<void> {
    this.db.prepare('DELETE FROM terminals WHERE project_id = ?').run(projectId);
  }
}
