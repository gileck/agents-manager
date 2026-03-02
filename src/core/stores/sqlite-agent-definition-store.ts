import type Database from 'better-sqlite3';
import type { AgentDefinition, AgentDefinitionCreateInput, AgentDefinitionUpdateInput, AgentModeConfig } from '../../shared/types';
import type { IAgentDefinitionStore } from '../interfaces/agent-definition-store';
import { generateId, now, parseJson } from './utils';
import { getAppLogger } from '../services/app-logger';

interface AgentDefinitionRow {
  id: string;
  name: string;
  description: string | null;
  engine: string;
  model: string | null;
  modes: string;
  system_prompt: string | null;
  timeout: number | null;
  skills: string;
  is_built_in: number;
  created_at: number;
  updated_at: number;
}

function rowToDefinition(row: AgentDefinitionRow): AgentDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    engine: row.engine,
    model: row.model,
    modes: parseJson<AgentModeConfig[]>(row.modes, []),
    systemPrompt: row.system_prompt,
    timeout: row.timeout,
    skills: parseJson<string[]>(row.skills, []),
    isBuiltIn: row.is_built_in === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteAgentDefinitionStore implements IAgentDefinitionStore {
  constructor(private db: Database.Database) {}

  async getDefinition(id: string): Promise<AgentDefinition | null> {
    try {
      const row = this.db.prepare('SELECT * FROM agent_definitions WHERE id = ?').get(id) as AgentDefinitionRow | undefined;
      return row ? rowToDefinition(row) : null;
    } catch (err) {
      getAppLogger().logError('AgentDefinitionStore', 'getDefinition failed', err);
      throw err;
    }
  }

  async listDefinitions(): Promise<AgentDefinition[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM agent_definitions ORDER BY is_built_in DESC, created_at DESC').all() as AgentDefinitionRow[];
      return rows.map(rowToDefinition);
    } catch (err) {
      getAppLogger().logError('AgentDefinitionStore', 'listDefinitions failed', err);
      throw err;
    }
  }

  async getDefinitionByAgentType(agentType: string): Promise<AgentDefinition | null> {
    try {
      const id = 'agent-def-' + agentType;
      return this.getDefinition(id);
    } catch (err) {
      getAppLogger().logError('AgentDefinitionStore', 'getDefinitionByAgentType failed', err);
      throw err;
    }
  }

  async getDefinitionByMode(mode: string): Promise<AgentDefinition | null> {
    try {
      const row = this.db.prepare(`
        SELECT ad.* FROM agent_definitions ad
        WHERE EXISTS (
          SELECT 1 FROM json_each(ad.modes) je
          WHERE json_extract(je.value, '$.mode') = ?
        )
        LIMIT 1
      `).get(mode) as AgentDefinitionRow | undefined;
      return row ? rowToDefinition(row) : null;
    } catch (err) {
      getAppLogger().logError('AgentDefinitionStore', 'getDefinitionByMode failed', err);
      throw err;
    }
  }

  async createDefinition(input: AgentDefinitionCreateInput): Promise<AgentDefinition> {
    try {
      const id = generateId();
      const timestamp = now();

      this.db.prepare(`
        INSERT INTO agent_definitions (id, name, description, engine, model, modes, system_prompt, timeout, skills, is_built_in, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        id,
        input.name,
        input.description ?? null,
        input.engine,
        input.model ?? null,
        JSON.stringify(input.modes ?? []),
        input.systemPrompt ?? null,
        input.timeout ?? null,
        JSON.stringify(input.skills ?? []),
        timestamp,
        timestamp,
      );

      return (await this.getDefinition(id))!;
    } catch (err) {
      getAppLogger().logError('AgentDefinitionStore', 'createDefinition failed', err);
      throw err;
    }
  }

  async updateDefinition(id: string, input: AgentDefinitionUpdateInput): Promise<AgentDefinition | null> {
    try {
      const existing = await this.getDefinition(id);
      if (!existing) return null;

      const updates: string[] = [];
      const values: unknown[] = [];

      if (input.name !== undefined) {
        updates.push('name = ?');
        values.push(input.name);
      }
      if (input.description !== undefined) {
        updates.push('description = ?');
        values.push(input.description);
      }
      if (input.engine !== undefined) {
        updates.push('engine = ?');
        values.push(input.engine);
      }
      if (input.model !== undefined) {
        updates.push('model = ?');
        values.push(input.model);
      }
      if (input.modes !== undefined) {
        updates.push('modes = ?');
        values.push(JSON.stringify(input.modes));
      }
      if (input.systemPrompt !== undefined) {
        updates.push('system_prompt = ?');
        values.push(input.systemPrompt);
      }
      if (input.timeout !== undefined) {
        updates.push('timeout = ?');
        values.push(input.timeout);
      }
      if (input.skills !== undefined) {
        updates.push('skills = ?');
        values.push(JSON.stringify(input.skills));
      }

      if (updates.length === 0) return existing;

      updates.push('updated_at = ?');
      values.push(now());
      values.push(id);

      this.db.prepare(`UPDATE agent_definitions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      return (await this.getDefinition(id))!;
    } catch (err) {
      getAppLogger().logError('AgentDefinitionStore', 'updateDefinition failed', err);
      throw err;
    }
  }

  async deleteDefinition(id: string): Promise<boolean> {
    try {
      const existing = await this.getDefinition(id);
      if (!existing) return false;
      if (existing.isBuiltIn) throw new Error('Cannot delete built-in agent definition');

      const result = this.db.prepare('DELETE FROM agent_definitions WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (err) {
      getAppLogger().logError('AgentDefinitionStore', 'deleteDefinition failed', err);
      throw err;
    }
  }
}
