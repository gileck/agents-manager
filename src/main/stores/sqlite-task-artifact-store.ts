import type Database from 'better-sqlite3';
import type { TaskArtifact, TaskArtifactCreateInput, ArtifactType } from '../../shared/types';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import { generateId, now, parseJson } from './utils';

interface TaskArtifactRow {
  id: string;
  task_id: string;
  type: string;
  data: string;
  created_at: number;
}

function rowToArtifact(row: TaskArtifactRow): TaskArtifact {
  return {
    id: row.id,
    taskId: row.task_id,
    type: row.type as ArtifactType,
    data: parseJson<Record<string, unknown>>(row.data, {}),
    createdAt: row.created_at,
  };
}

export class SqliteTaskArtifactStore implements ITaskArtifactStore {
  constructor(private db: Database.Database) {}

  async createArtifact(input: TaskArtifactCreateInput): Promise<TaskArtifact> {
    const id = generateId();
    const timestamp = now();

    this.db.prepare(`
      INSERT INTO task_artifacts (id, task_id, type, data, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.taskId, input.type, JSON.stringify(input.data ?? {}), timestamp);

    return {
      id,
      taskId: input.taskId,
      type: input.type,
      data: input.data ?? {},
      createdAt: timestamp,
    };
  }

  async getArtifactsForTask(taskId: string, type?: ArtifactType): Promise<TaskArtifact[]> {
    const conditions: string[] = ['task_id = ?'];
    const values: unknown[] = [taskId];

    if (type) {
      conditions.push('type = ?');
      values.push(type);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const rows = this.db.prepare(`SELECT * FROM task_artifacts ${where} ORDER BY created_at ASC`).all(...values) as TaskArtifactRow[];
    return rows.map(rowToArtifact);
  }

  async deleteArtifactsForTask(taskId: string): Promise<number> {
    const result = this.db.prepare('DELETE FROM task_artifacts WHERE task_id = ?').run(taskId);
    return result.changes;
  }
}
