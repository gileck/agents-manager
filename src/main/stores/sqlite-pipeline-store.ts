import type Database from 'better-sqlite3';
import type { Pipeline, PipelineCreateInput, PipelineUpdateInput, PipelineStatus, Transition } from '../../shared/types';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import { generateId, now, parseJson } from './utils';

interface PipelineRow {
  id: string;
  name: string;
  description: string | null;
  statuses: string;
  transitions: string;
  task_type: string;
  created_at: number;
  updated_at: number;
}

function rowToPipeline(row: PipelineRow): Pipeline {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    statuses: parseJson<PipelineStatus[]>(row.statuses, []),
    transitions: parseJson<Transition[]>(row.transitions, []),
    taskType: row.task_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validatePipelineInput(input: { statuses?: PipelineStatus[]; transitions?: Transition[] }): void {
  if (input.statuses !== undefined) {
    if (!Array.isArray(input.statuses) || input.statuses.length === 0) {
      throw new Error('Pipeline must have at least one status');
    }
    const names = new Set<string>();
    for (const s of input.statuses) {
      if (!s.name || typeof s.name !== 'string') throw new Error('Each status must have a non-empty name');
      if (!s.label || typeof s.label !== 'string') throw new Error(`Status "${s.name}" must have a non-empty label`);
      if (names.has(s.name)) throw new Error(`Duplicate status name: "${s.name}"`);
      names.add(s.name);
    }
  }
  if (input.transitions !== undefined) {
    if (!Array.isArray(input.transitions)) {
      throw new Error('Transitions must be an array');
    }
    const statusNames = input.statuses ? new Set(input.statuses.map(s => s.name)) : null;
    for (const t of input.transitions) {
      if (!t.from || typeof t.from !== 'string') throw new Error('Each transition must have a "from" status');
      if (!t.to || typeof t.to !== 'string') throw new Error('Each transition must have a "to" status');
      if (!t.trigger || !['manual', 'agent', 'system'].includes(t.trigger)) {
        throw new Error(`Invalid trigger "${t.trigger}" — must be manual, agent, or system`);
      }
      if (statusNames) {
        if (t.from !== '*' && !statusNames.has(t.from)) throw new Error(`Transition "from" references unknown status: "${t.from}"`);
        if (!statusNames.has(t.to)) throw new Error(`Transition "to" references unknown status: "${t.to}"`);
      }
    }
  }
}

export class SqlitePipelineStore implements IPipelineStore {
  constructor(private db: Database.Database) {}

  async getPipeline(id: string): Promise<Pipeline | null> {
    const row = this.db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as PipelineRow | undefined;
    return row ? rowToPipeline(row) : null;
  }

  async listPipelines(): Promise<Pipeline[]> {
    const rows = this.db.prepare('SELECT * FROM pipelines ORDER BY created_at ASC').all() as PipelineRow[];
    return rows.map(rowToPipeline);
  }

  async createPipeline(input: PipelineCreateInput): Promise<Pipeline> {
    validatePipelineInput(input);
    const id = generateId();
    const timestamp = now();

    this.db.prepare(`
      INSERT INTO pipelines (id, name, description, statuses, transitions, task_type, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.description ?? null,
      JSON.stringify(input.statuses),
      JSON.stringify(input.transitions),
      input.taskType,
      timestamp,
      timestamp,
    );

    return (await this.getPipeline(id))!;
  }

  async updatePipeline(id: string, input: PipelineUpdateInput): Promise<Pipeline | null> {
    const existing = await this.getPipeline(id);
    if (!existing) return null;

    validatePipelineInput({
      statuses: input.statuses ?? existing.statuses,
      transitions: input.transitions ?? existing.transitions,
    });

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
    if (input.statuses !== undefined) {
      updates.push('statuses = ?');
      values.push(JSON.stringify(input.statuses));
    }
    if (input.transitions !== undefined) {
      updates.push('transitions = ?');
      values.push(JSON.stringify(input.transitions));
    }
    if (input.taskType !== undefined) {
      updates.push('task_type = ?');
      values.push(input.taskType);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = ?');
    values.push(now());
    values.push(id);

    this.db.prepare(`UPDATE pipelines SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return (await this.getPipeline(id))!;
  }

  async deletePipeline(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM pipelines WHERE id = ?').run(id);
    return result.changes > 0;
  }

  async getPipelineForTaskType(taskType: string): Promise<Pipeline | null> {
    const row = this.db.prepare('SELECT * FROM pipelines WHERE task_type = ?').get(taskType) as PipelineRow | undefined;
    return row ? rowToPipeline(row) : null;
  }
}
