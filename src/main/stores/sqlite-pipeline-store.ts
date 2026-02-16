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

export class SqlitePipelineStore implements IPipelineStore {
  constructor(private db: Database.Database) {}

  getPipeline(id: string): Pipeline | null {
    const row = this.db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as PipelineRow | undefined;
    return row ? rowToPipeline(row) : null;
  }

  listPipelines(): Pipeline[] {
    const rows = this.db.prepare('SELECT * FROM pipelines ORDER BY created_at ASC').all() as PipelineRow[];
    return rows.map(rowToPipeline);
  }

  createPipeline(input: PipelineCreateInput): Pipeline {
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

    return this.getPipeline(id)!;
  }

  updatePipeline(id: string, input: PipelineUpdateInput): Pipeline | null {
    const existing = this.getPipeline(id);
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
    return this.getPipeline(id)!;
  }

  deletePipeline(id: string): boolean {
    const result = this.db.prepare('DELETE FROM pipelines WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getPipelineForTaskType(taskType: string): Pipeline | null {
    const row = this.db.prepare('SELECT * FROM pipelines WHERE task_type = ?').get(taskType) as PipelineRow | undefined;
    return row ? rowToPipeline(row) : null;
  }
}
