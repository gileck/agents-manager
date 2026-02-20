import type Database from 'better-sqlite3';
import type { AgentRun, AgentRunCreateInput, AgentRunUpdateInput } from '../../shared/types';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import { generateId, now, parseJson } from './utils';

interface AgentRunRow {
  id: string;
  task_id: string;
  agent_type: string;
  mode: string;
  status: string;
  output: string | null;
  outcome: string | null;
  payload: string | null;
  exit_code: number | null;
  started_at: number;
  completed_at: number | null;
  cost_input_tokens: number | null;
  cost_output_tokens: number | null;
  prompt: string | null;
}

function rowToRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    taskId: row.task_id,
    agentType: row.agent_type,
    mode: row.mode as AgentRun['mode'],
    status: row.status as AgentRun['status'],
    output: row.output,
    outcome: row.outcome,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    exitCode: row.exit_code,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    costInputTokens: row.cost_input_tokens,
    costOutputTokens: row.cost_output_tokens,
    prompt: row.prompt,
  };
}

export class SqliteAgentRunStore implements IAgentRunStore {
  constructor(private db: Database.Database) {}

  async createRun(input: AgentRunCreateInput): Promise<AgentRun> {
    const id = generateId();
    const timestamp = now();

    this.db.prepare(`
      INSERT INTO agent_runs (id, task_id, agent_type, mode, status, started_at)
      VALUES (?, ?, ?, ?, 'running', ?)
    `).run(id, input.taskId, input.agentType, input.mode, timestamp);

    return (await this.getRun(id))!;
  }

  async updateRun(id: string, input: AgentRunUpdateInput): Promise<AgentRun | null> {
    const existing = await this.getRun(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }
    if (input.output !== undefined) {
      updates.push('output = ?');
      values.push(input.output);
    }
    if (input.outcome !== undefined) {
      updates.push('outcome = ?');
      values.push(input.outcome);
    }
    if (input.payload !== undefined) {
      updates.push('payload = ?');
      values.push(JSON.stringify(input.payload));
    }
    if (input.exitCode !== undefined) {
      updates.push('exit_code = ?');
      values.push(input.exitCode);
    }
    if (input.completedAt !== undefined) {
      updates.push('completed_at = ?');
      values.push(input.completedAt);
    }
    if (input.costInputTokens !== undefined) {
      updates.push('cost_input_tokens = ?');
      values.push(input.costInputTokens);
    }
    if (input.costOutputTokens !== undefined) {
      updates.push('cost_output_tokens = ?');
      values.push(input.costOutputTokens);
    }
    if (input.prompt !== undefined) {
      updates.push('prompt = ?');
      values.push(input.prompt);
    }

    if (updates.length === 0) return existing;

    values.push(id);
    this.db.prepare(`UPDATE agent_runs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return (await this.getRun(id))!;
  }

  async getRun(id: string): Promise<AgentRun | null> {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  async getRunsForTask(taskId: string): Promise<AgentRun[]> {
    const rows = this.db.prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC').all(taskId) as AgentRunRow[];
    return rows.map(rowToRun);
  }

  async getActiveRuns(): Promise<AgentRun[]> {
    const rows = this.db.prepare("SELECT * FROM agent_runs WHERE status = 'running'").all() as AgentRunRow[];
    return rows.map(rowToRun);
  }

  async getAllRuns(): Promise<AgentRun[]> {
    const rows = this.db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 1000').all() as AgentRunRow[];
    return rows.map(rowToRun);
  }
}
