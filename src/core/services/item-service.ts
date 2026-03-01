import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { Item, ItemCreateInput, ItemUpdateInput } from '../../shared/types';

interface ItemRow { id: string; name: string; description: string | null; created_at: string; updated_at: string; }

export function createItem(db: Database.Database, input: ItemCreateInput): Item {
  const id = randomUUID();
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

export function getItem(db: Database.Database, id: string): Item | null {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listItems(db: Database.Database): Item[] {
  const rows = db.prepare('SELECT * FROM items ORDER BY created_at DESC').all() as ItemRow[];

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function updateItem(db: Database.Database, id: string, input: ItemUpdateInput): Item | null {
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
    return getItem(db, id);
  }

  updates.push('updated_at = ?');
  values.push(now);

  values.push(id);

  db.prepare(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  return getItem(db, id);
}

export function deleteItem(db: Database.Database, id: string): boolean {
  const result = db.prepare('DELETE FROM items WHERE id = ?').run(id);
  return result.changes > 0;
}
