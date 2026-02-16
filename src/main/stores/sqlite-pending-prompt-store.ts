import type Database from 'better-sqlite3';
import type { PendingPrompt, PendingPromptCreateInput } from '../../shared/types';
import type { IPendingPromptStore } from '../interfaces/pending-prompt-store';
import { generateId, now, parseJson } from './utils';

interface PendingPromptRow {
  id: string;
  task_id: string;
  agent_run_id: string;
  prompt_type: string;
  payload: string;
  response: string | null;
  status: string;
  created_at: number;
  answered_at: number | null;
}

function rowToPrompt(row: PendingPromptRow): PendingPrompt {
  return {
    id: row.id,
    taskId: row.task_id,
    agentRunId: row.agent_run_id,
    promptType: row.prompt_type,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    response: parseJson<Record<string, unknown> | null>(row.response, null),
    status: row.status as PendingPrompt['status'],
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  };
}

export class SqlitePendingPromptStore implements IPendingPromptStore {
  constructor(private db: Database.Database) {}

  async createPrompt(input: PendingPromptCreateInput): Promise<PendingPrompt> {
    const id = generateId();
    const timestamp = now();

    this.db.prepare(`
      INSERT INTO pending_prompts (id, task_id, agent_run_id, prompt_type, payload, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, input.taskId, input.agentRunId, input.promptType, JSON.stringify(input.payload ?? {}), timestamp);

    return (await this.getPrompt(id))!;
  }

  async answerPrompt(id: string, response: Record<string, unknown>): Promise<PendingPrompt | null> {
    const timestamp = now();
    const result = this.db.prepare(`
      UPDATE pending_prompts SET response = ?, status = 'answered', answered_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(JSON.stringify(response), timestamp, id);

    if (result.changes === 0) return null;
    return (await this.getPrompt(id))!;
  }

  async getPrompt(id: string): Promise<PendingPrompt | null> {
    const row = this.db.prepare('SELECT * FROM pending_prompts WHERE id = ?').get(id) as PendingPromptRow | undefined;
    return row ? rowToPrompt(row) : null;
  }

  async getPendingForTask(taskId: string): Promise<PendingPrompt[]> {
    const rows = this.db.prepare("SELECT * FROM pending_prompts WHERE task_id = ? AND status = 'pending' ORDER BY created_at ASC").all(taskId) as PendingPromptRow[];
    return rows.map(rowToPrompt);
  }

  async expirePromptsForRun(agentRunId: string): Promise<number> {
    const result = this.db.prepare(`
      UPDATE pending_prompts SET status = 'expired'
      WHERE agent_run_id = ? AND status = 'pending'
    `).run(agentRunId);
    return result.changes;
  }
}
