import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getMigrations } from '../main/migrations';
import { createAppServices, type AppServices } from '../main/providers/setup';

const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'agents-manager',
  'agents-manager.db',
);

function resolveDbPath(flagPath?: string): string {
  if (flagPath) return flagPath;
  if (process.env.AM_DB_PATH) return process.env.AM_DB_PATH;
  return DEFAULT_DB_PATH;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = (db
    .prepare('SELECT name FROM migrations')
    .all() as { name: string }[])
    .map((row) => row.name);

  for (const migration of getMigrations()) {
    if (!applied.includes(migration.name)) {
      const transaction = db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
      });
      transaction();
    }
  }
}

export function openDatabase(flagPath?: string): { db: Database.Database; services: AppServices } {
  const dbPath = resolveDbPath(flagPath);

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  const services = createAppServices(db);
  return { db, services };
}
