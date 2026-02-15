import { getDatabase, generateId } from '@template/main/services/database';
import type { Item, ItemCreateInput, ItemUpdateInput } from '../../shared/types';

export function createItem(input: ItemCreateInput): Item {
  const db = getDatabase();
  const id = generateId();
  const now = new Date().toISOString();

  db.prepare(`
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

export function getItem(id: string): Item | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as any;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listItems(): Item[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM items ORDER BY created_at DESC').all() as any[];

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function updateItem(id: string, input: ItemUpdateInput): Item | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const updates: string[] = [];
  const values: any[] = [];

  if (input.name !== undefined) {
    updates.push('name = ?');
    values.push(input.name);
  }

  if (input.description !== undefined) {
    updates.push('description = ?');
    values.push(input.description);
  }

  if (updates.length === 0) {
    return getItem(id);
  }

  updates.push('updated_at = ?');
  values.push(now);

  values.push(id);

  db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return getItem(id);
}

export function deleteItem(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM items WHERE id = ?').run(id);
  return result.changes > 0;
}
