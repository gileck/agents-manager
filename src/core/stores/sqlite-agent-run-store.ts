import type Database from 'better-sqlite3';
import type { AgentRun, AgentRunCreateInput, AgentRunUpdateInput, AgentChatMessage, RunDiagnostics } from '../../shared/types';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import { generateId, now, parseJson } from './utils';
import { getAppLogger } from '../services/app-logger';

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
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  total_cost_usd: number | null;
  prompt: string | null;
  error: string | null;
  timeout_ms: number | null;
  max_turns: number | null;
  message_count: number | null;
  messages: string | null;
  automated_agent_id: string | null;
  model: string | null;
  engine: string | null;
  session_id: string | null;
  diagnostics: string | null;
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
    cacheReadInputTokens: row.cache_read_input_tokens ?? null,
    cacheCreationInputTokens: row.cache_creation_input_tokens ?? null,
    totalCostUsd: row.total_cost_usd ?? null,
    prompt: row.prompt,
    error: row.error ?? null,
    timeoutMs: row.timeout_ms ?? null,
    maxTurns: row.max_turns ?? null,
    messageCount: row.message_count ?? null,
    messages: parseJson<AgentChatMessage[] | null>(row.messages, null),
    automatedAgentId: row.automated_agent_id ?? null,
    model: row.model ?? null,
    engine: row.engine ?? null,
    sessionId: row.session_id ?? null,
    diagnostics: parseJson<RunDiagnostics | null>(row.diagnostics, null),
  };
}

export class SqliteAgentRunStore implements IAgentRunStore {
  constructor(private db: Database.Database) {}

  async createRun(input: AgentRunCreateInput): Promise<AgentRun> {
    try {
      const id = generateId();
      const timestamp = now();

      if (input.automatedAgentId) {
        this.db.prepare(`
          INSERT INTO agent_runs (id, task_id, agent_type, mode, status, started_at, automated_agent_id)
          VALUES (?, ?, ?, ?, 'running', ?, ?)
        `).run(id, input.taskId, input.agentType, input.mode, timestamp, input.automatedAgentId);
      } else {
        this.db.prepare(`
          INSERT INTO agent_runs (id, task_id, agent_type, mode, status, started_at)
          VALUES (?, ?, ?, ?, 'running', ?)
        `).run(id, input.taskId, input.agentType, input.mode, timestamp);
      }

      return (await this.getRun(id))!;
    } catch (err) {
      getAppLogger().logError('AgentRunStore', 'createRun failed', err);
      throw err;
    }
  }

  async updateRun(id: string, input: AgentRunUpdateInput): Promise<AgentRun | null> {
    try {
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
      if (input.cacheReadInputTokens !== undefined) {
        updates.push('cache_read_input_tokens = ?');
        values.push(input.cacheReadInputTokens);
      }
      if (input.cacheCreationInputTokens !== undefined) {
        updates.push('cache_creation_input_tokens = ?');
        values.push(input.cacheCreationInputTokens);
      }
      if (input.totalCostUsd !== undefined) {
        updates.push('total_cost_usd = ?');
        values.push(input.totalCostUsd);
      }
      if (input.prompt !== undefined) {
        updates.push('prompt = ?');
        values.push(input.prompt);
      }
      if (input.error !== undefined) {
        updates.push('error = ?');
        values.push(input.error);
      }
      if (input.timeoutMs !== undefined) {
        updates.push('timeout_ms = ?');
        values.push(input.timeoutMs);
      }
      if (input.maxTurns !== undefined) {
        updates.push('max_turns = ?');
        values.push(input.maxTurns);
      }
      if (input.messageCount !== undefined) {
        updates.push('message_count = ?');
        values.push(input.messageCount);
      }
      if (input.messages !== undefined) {
        updates.push('messages = ?');
        values.push(JSON.stringify(input.messages));
      }
      if (input.model !== undefined) {
        updates.push('model = ?');
        values.push(input.model);
      }
      if (input.engine !== undefined) {
        updates.push('engine = ?');
        values.push(input.engine);
      }
      if (input.sessionId !== undefined) {
        updates.push('session_id = ?');
        values.push(input.sessionId);
      }
      if (input.diagnostics !== undefined) {
        updates.push('diagnostics = ?');
        values.push(JSON.stringify(input.diagnostics));
      }

      if (updates.length === 0) return existing;

      values.push(id);
      this.db.prepare(`UPDATE agent_runs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      return (await this.getRun(id))!;
    } catch (err) {
      getAppLogger().logError('AgentRunStore', 'updateRun failed', err);
      throw err;
    }
  }

  async getRun(id: string): Promise<AgentRun | null> {
    try {
      const row = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(id) as AgentRunRow | undefined;
      return row ? rowToRun(row) : null;
    } catch (err) {
      getAppLogger().logError('AgentRunStore', 'getRun failed', err);
      throw err;
    }
  }

  async getRunsForTask(taskId: string): Promise<AgentRun[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM agent_runs WHERE task_id = ? ORDER BY started_at DESC').all(taskId) as AgentRunRow[];
      return rows.map(rowToRun);
    } catch (err) {
      getAppLogger().logError('AgentRunStore', 'getRunsForTask failed', err);
      throw err;
    }
  }

  async getActiveRuns(): Promise<AgentRun[]> {
    try {
      const rows = this.db.prepare("SELECT * FROM agent_runs WHERE status = 'running'").all() as AgentRunRow[];
      return rows.map(rowToRun);
    } catch (err) {
      getAppLogger().logError('AgentRunStore', 'getActiveRuns failed', err);
      throw err;
    }
  }

  async getAllRuns(limit?: number): Promise<AgentRun[]> {
    try {
      const sql = limit
        ? 'SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?'
        : 'SELECT * FROM agent_runs ORDER BY started_at DESC';
      const rows = (limit ? this.db.prepare(sql).all(limit) : this.db.prepare(sql).all()) as AgentRunRow[];
      return rows.map(rowToRun);
    } catch (err) {
      getAppLogger().logError('AgentRunStore', 'getAllRuns failed', err);
      throw err;
    }
  }

  async getRunsForAutomatedAgent(automatedAgentId: string, limit: number = 50): Promise<AgentRun[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM agent_runs WHERE automated_agent_id = ? ORDER BY started_at DESC LIMIT ?').all(automatedAgentId, limit) as AgentRunRow[];
      return rows.map(rowToRun);
    } catch (err) {
      getAppLogger().logError('AgentRunStore', 'getRunsForAutomatedAgent failed', err);
      throw err;
    }
  }

  async getActiveRunForAutomatedAgent(automatedAgentId: string): Promise<AgentRun | null> {
    try {
      const row = this.db.prepare("SELECT * FROM agent_runs WHERE automated_agent_id = ? AND status = 'running' LIMIT 1").get(automatedAgentId) as AgentRunRow | undefined;
      return row ? rowToRun(row) : null;
    } catch (err) {
      getAppLogger().logError('AgentRunStore', 'getActiveRunForAutomatedAgent failed', err);
      throw err;
    }
  }

  countFailedRunsSync(_taskId: string): number {
    throw new Error('Not implemented');
  }

  countRunningRunsSync(_taskId: string): number {
    throw new Error('Not implemented');
  }
}
