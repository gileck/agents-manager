import type Database from 'better-sqlite3';
import type { TaskPhase, TaskPhaseCreateInput, TaskPhaseUpdateInput } from '../../shared/types';
import type { ITaskPhaseStore } from '../interfaces/task-phase-store';
import { generateId } from './utils';

interface TaskPhaseRow {
  id: string;
  task_id: string;
  phase: string;
  status: string;
  agent_run_id: string | null;
  started_at: number | null;
  completed_at: number | null;
}

function rowToPhase(row: TaskPhaseRow): TaskPhase {
  return {
    id: row.id,
    taskId: row.task_id,
    phase: row.phase,
    status: row.status as TaskPhase['status'],
    agentRunId: row.agent_run_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export class SqliteTaskPhaseStore implements ITaskPhaseStore {
  constructor(private db: Database.Database) {}

  async createPhase(input: TaskPhaseCreateInput): Promise<TaskPhase> {
    const id = generateId();

    this.db.prepare(`
      INSERT INTO task_phases (id, task_id, phase, status)
      VALUES (?, ?, ?, 'pending')
    `).run(id, input.taskId, input.phase);

    return (await this.getPhase(id))!;
  }

  async updatePhase(id: string, input: TaskPhaseUpdateInput): Promise<TaskPhase | null> {
    const existing = await this.getPhase(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }
    if (input.agentRunId !== undefined) {
      updates.push('agent_run_id = ?');
      values.push(input.agentRunId);
    }
    if (input.startedAt !== undefined) {
      updates.push('started_at = ?');
      values.push(input.startedAt);
    }
    if (input.completedAt !== undefined) {
      updates.push('completed_at = ?');
      values.push(input.completedAt);
    }

    if (updates.length === 0) return existing;

    values.push(id);
    this.db.prepare(`UPDATE task_phases SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return (await this.getPhase(id))!;
  }

  async getPhasesForTask(taskId: string): Promise<TaskPhase[]> {
    const rows = this.db.prepare('SELECT * FROM task_phases WHERE task_id = ? ORDER BY started_at ASC').all(taskId) as TaskPhaseRow[];
    return rows.map(rowToPhase);
  }

  async getActivePhase(taskId: string): Promise<TaskPhase | null> {
    const row = this.db.prepare("SELECT * FROM task_phases WHERE task_id = ? AND status = 'active' LIMIT 1").get(taskId) as TaskPhaseRow | undefined;
    return row ? rowToPhase(row) : null;
  }

  private async getPhase(id: string): Promise<TaskPhase | null> {
    const row = this.db.prepare('SELECT * FROM task_phases WHERE id = ?').get(id) as TaskPhaseRow | undefined;
    return row ? rowToPhase(row) : null;
  }
}
