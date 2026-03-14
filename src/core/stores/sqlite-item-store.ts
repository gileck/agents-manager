import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { Item, ItemCreateInput, ItemUpdateInput } from '../../shared/types';
import type { IItemStore } from '../interfaces/item-store';

interface ItemRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function rowToItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteItemStore implements IItemStore {
  constructor(private db: Database.Database) {}

  async createItem(input: ItemCreateInput): Promise<Item> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO items (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.name, input.description || null, now, now);

    return {
      id,
      name: input.name,
      description: input.description || null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getItem(id: string): Promise<Item | null> {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
    if (!row) return null;
    return rowToItem(row);
  }

  async listItems(): Promise<Item[]> {
    const rows = this.db.prepare('SELECT * FROM items ORDER BY created_at DESC').all() as ItemRow[];
    return rows.map(rowToItem);
  }

  async updateItem(id: string, input: ItemUpdateInput): Promise<Item | null> {
    const now = new Date().toISOString();

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);
    }

    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }

    if (updates.length === 0) {
      return this.getItem(id);
    }

    updates.push('updated_at = ?');
    values.push(now);

    values.push(id);

    this.db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.getItem(id);
  }

  async deleteItem(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM items WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
