import type Database from 'better-sqlite3';
import type { Project, ProjectCreateInput, ProjectUpdateInput } from '../../shared/types';
import type { IProjectStore } from '../interfaces/project-store';
import { generateId, now, parseJson } from './utils';

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  path: string | null;
  config: string;
  created_at: number;
  updated_at: number;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    path: row.path,
    config: parseJson<Record<string, unknown>>(row.config, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteProjectStore implements IProjectStore {
  constructor(private db: Database.Database) {}

  async getProject(id: string): Promise<Project | null> {
    try {
      const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
      return row ? rowToProject(row) : null;
    } catch (err) {
      console.error('SqliteProjectStore.getProject failed:', err);
      throw err;
    }
  }

  async listProjects(): Promise<Project[]> {
    try {
      const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as ProjectRow[];
      return rows.map(rowToProject);
    } catch (err) {
      console.error('SqliteProjectStore.listProjects failed:', err);
      throw err;
    }
  }

  async createProject(input: ProjectCreateInput): Promise<Project> {
    try {
      const id = generateId();
      const timestamp = now();
      const config = JSON.stringify(input.config ?? {});

      this.db.prepare(`
        INSERT INTO projects (id, name, description, path, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name, input.description ?? null, input.path ?? null, config, timestamp, timestamp);

      return (await this.getProject(id))!;
    } catch (err) {
      console.error('SqliteProjectStore.createProject failed:', err);
      throw err;
    }
  }

  async updateProject(id: string, input: ProjectUpdateInput): Promise<Project | null> {
    try {
      const existing = await this.getProject(id);
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
      if (input.path !== undefined) {
        updates.push('path = ?');
        values.push(input.path);
      }
      if (input.config !== undefined) {
        updates.push('config = ?');
        values.push(JSON.stringify(input.config));
      }

      if (updates.length === 0) return existing;

      updates.push('updated_at = ?');
      values.push(now());
      values.push(id);

      this.db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      return (await this.getProject(id))!;
    } catch (err) {
      console.error('SqliteProjectStore.updateProject failed:', err);
      throw err;
    }
  }

  async deleteProject(id: string): Promise<boolean> {
    try {
      const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (err) {
      console.error('SqliteProjectStore.deleteProject failed:', err);
      throw err;
    }
  }
}
