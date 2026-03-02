import type Database from 'better-sqlite3';
import type { AutomatedAgent, AutomatedAgentCreateInput, AutomatedAgentUpdateInput, AutomatedAgentCapabilities, AutomatedAgentSchedule } from '../../shared/types';
import type { IAutomatedAgentStore } from '../interfaces/automated-agent-store';
import { generateId, now, parseJson } from './utils';
import { getAppLogger } from '../services/app-logger';
import { computeNextRunAt } from '../services/automated-agent-schedule';

interface AutomatedAgentRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  prompt_instructions: string;
  capabilities: string;
  schedule: string;
  enabled: number;
  max_run_duration_ms: number;
  template_id: string | null;
  last_run_at: number | null;
  last_run_status: string | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
}

const DEFAULT_CAPABILITIES: AutomatedAgentCapabilities = {
  canCreateTasks: false,
  canModifyTasks: false,
  readOnly: true,
  dryRun: false,
  maxActions: 50,
};

function rowToAgent(row: AutomatedAgentRow): AutomatedAgent {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    promptInstructions: row.prompt_instructions,
    capabilities: parseJson<AutomatedAgentCapabilities>(row.capabilities, DEFAULT_CAPABILITIES),
    schedule: parseJson<AutomatedAgentSchedule>(row.schedule, { type: 'manual', value: '' }),
    enabled: row.enabled === 1,
    maxRunDurationMs: row.max_run_duration_ms,
    templateId: row.template_id,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteAutomatedAgentStore implements IAutomatedAgentStore {
  constructor(private db: Database.Database) {}

  async getAgent(id: string): Promise<AutomatedAgent | null> {
    try {
      const row = this.db.prepare('SELECT * FROM automated_agents WHERE id = ?').get(id) as AutomatedAgentRow | undefined;
      return row ? rowToAgent(row) : null;
    } catch (err) {
      getAppLogger().logError('AutomatedAgentStore', 'getAgent failed', err);
      throw err;
    }
  }

  async listAgents(projectId?: string): Promise<AutomatedAgent[]> {
    try {
      let rows: AutomatedAgentRow[];
      if (projectId) {
        rows = this.db.prepare('SELECT * FROM automated_agents WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as AutomatedAgentRow[];
      } else {
        rows = this.db.prepare('SELECT * FROM automated_agents ORDER BY created_at DESC').all() as AutomatedAgentRow[];
      }
      return rows.map(rowToAgent);
    } catch (err) {
      getAppLogger().logError('AutomatedAgentStore', 'listAgents failed', err);
      throw err;
    }
  }

  async listDueAgents(nowMs: number): Promise<AutomatedAgent[]> {
    try {
      const rows = this.db.prepare(
        `SELECT * FROM automated_agents WHERE enabled = 1 AND json_extract(schedule, '$.type') != 'manual' AND next_run_at IS NOT NULL AND next_run_at <= ?`,
      ).all(nowMs) as AutomatedAgentRow[];
      return rows.map(rowToAgent);
    } catch (err) {
      getAppLogger().logError('AutomatedAgentStore', 'listDueAgents failed', err);
      throw err;
    }
  }

  async createAgent(input: AutomatedAgentCreateInput): Promise<AutomatedAgent> {
    try {
      const id = generateId();
      const timestamp = now();
      const capabilities: AutomatedAgentCapabilities = { ...DEFAULT_CAPABILITIES, ...input.capabilities };
      const enabled = input.enabled !== false;
      const nextRunAt = enabled ? computeNextRunAt(input.schedule, timestamp) : null;

      this.db.prepare(`
        INSERT INTO automated_agents (id, project_id, name, description, prompt_instructions, capabilities, schedule, enabled, max_run_duration_ms, template_id, next_run_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.projectId,
        input.name,
        input.description ?? null,
        input.promptInstructions,
        JSON.stringify(capabilities),
        JSON.stringify(input.schedule),
        enabled ? 1 : 0,
        input.maxRunDurationMs ?? 600000,
        input.templateId ?? null,
        nextRunAt,
        timestamp,
        timestamp,
      );

      const agent = await this.getAgent(id);
      if (!agent) throw new Error(`Failed to read back created agent ${id}`);
      return agent;
    } catch (err) {
      getAppLogger().logError('AutomatedAgentStore', 'createAgent failed', err);
      throw err;
    }
  }

  async updateAgent(id: string, input: AutomatedAgentUpdateInput): Promise<AutomatedAgent | null> {
    try {
      const existing = await this.getAgent(id);
      if (!existing) return null;

      const updates: string[] = [];
      const values: unknown[] = [];

      if (input.name !== undefined) { updates.push('name = ?'); values.push(input.name); }
      if (input.description !== undefined) { updates.push('description = ?'); values.push(input.description); }
      if (input.promptInstructions !== undefined) { updates.push('prompt_instructions = ?'); values.push(input.promptInstructions); }
      if (input.capabilities !== undefined) {
        const merged = { ...existing.capabilities, ...input.capabilities };
        updates.push('capabilities = ?');
        values.push(JSON.stringify(merged));
      }
      if (input.schedule !== undefined) { updates.push('schedule = ?'); values.push(JSON.stringify(input.schedule)); }
      if (input.enabled !== undefined) { updates.push('enabled = ?'); values.push(input.enabled ? 1 : 0); }
      if (input.maxRunDurationMs !== undefined) { updates.push('max_run_duration_ms = ?'); values.push(input.maxRunDurationMs); }

      // Recompute nextRunAt when schedule or enabled changes
      if (input.schedule !== undefined || input.enabled !== undefined) {
        const newEnabled = input.enabled !== undefined ? input.enabled : existing.enabled;
        const newSchedule = input.schedule !== undefined ? input.schedule : existing.schedule;
        const nextRunAt = newEnabled ? computeNextRunAt(newSchedule, now()) : null;
        updates.push('next_run_at = ?');
        values.push(nextRunAt);
      }

      if (updates.length === 0) return existing;

      updates.push('updated_at = ?');
      values.push(now());
      values.push(id);

      this.db.prepare(`UPDATE automated_agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      const updated = await this.getAgent(id);
      if (!updated) throw new Error(`Failed to read back updated agent ${id}`);
      return updated;
    } catch (err) {
      getAppLogger().logError('AutomatedAgentStore', 'updateAgent failed', err);
      throw err;
    }
  }

  async deleteAgent(id: string): Promise<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM automated_agents WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (err) {
      getAppLogger().logError('AutomatedAgentStore', 'deleteAgent failed', err);
      throw err;
    }
  }

  async recordRun(id: string, runAt: number, status: string, nextRunAt: number | null): Promise<void> {
    try {
      this.db.prepare(
        'UPDATE automated_agents SET last_run_at = ?, last_run_status = ?, next_run_at = ?, updated_at = ? WHERE id = ?',
      ).run(runAt, status, nextRunAt, now(), id);
    } catch (err) {
      getAppLogger().logError('AutomatedAgentStore', 'recordRun failed', err);
      throw err;
    }
  }

  async setNextRunAt(id: string, nextRunAt: number | null): Promise<void> {
    try {
      this.db.prepare(
        'UPDATE automated_agents SET next_run_at = ?, updated_at = ? WHERE id = ?',
      ).run(nextRunAt, now(), id);
    } catch (err) {
      getAppLogger().logError('AutomatedAgentStore', 'setNextRunAt failed', err);
      throw err;
    }
  }
}
