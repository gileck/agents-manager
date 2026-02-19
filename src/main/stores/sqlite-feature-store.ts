import type Database from 'better-sqlite3';
import type { Feature, FeatureCreateInput, FeatureUpdateInput, FeatureFilter } from '../../shared/types';
import type { IFeatureStore } from '../interfaces/feature-store';
import { generateId, now } from './utils';

interface FeatureRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

function rowToFeature(row: FeatureRow): Feature {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteFeatureStore implements IFeatureStore {
  constructor(private db: Database.Database) {}

  async getFeature(id: string): Promise<Feature | null> {
    const row = this.db.prepare('SELECT * FROM features WHERE id = ?').get(id) as FeatureRow | undefined;
    return row ? rowToFeature(row) : null;
  }

  async listFeatures(filter?: FeatureFilter): Promise<Feature[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (filter?.projectId) {
      conditions.push('project_id = ?');
      values.push(filter.projectId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(`SELECT * FROM features ${where} ORDER BY created_at DESC`).all(...values) as FeatureRow[];
    return rows.map(rowToFeature);
  }

  async createFeature(input: FeatureCreateInput): Promise<Feature> {
    const id = generateId();
    const timestamp = now();

    this.db.prepare(`
      INSERT INTO features (id, project_id, title, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.projectId, input.title, input.description ?? null, timestamp, timestamp);

    return (await this.getFeature(id))!;
  }

  async updateFeature(id: string, input: FeatureUpdateInput): Promise<Feature | null> {
    const existing = await this.getFeature(id);
    if (!existing) return null;

    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.title !== undefined) {
      updates.push('title = ?');
      values.push(input.title);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }

    if (updates.length === 0) return existing;

    updates.push('updated_at = ?');
    values.push(now());
    values.push(id);

    this.db.prepare(`UPDATE features SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return (await this.getFeature(id))!;
  }

  async deleteFeature(id: string): Promise<boolean> {
    // Unlink tasks from this feature
    this.db.prepare('UPDATE tasks SET feature_id = NULL WHERE feature_id = ?').run(id);
    const result = this.db.prepare('DELETE FROM features WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
