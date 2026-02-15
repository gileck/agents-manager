import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';

let db: Database.Database | null = null;

export interface Migration {
  name: string;
  sql: string;
}

export interface DatabaseConfig {
  filename: string;
  migrations: Migration[];
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(config: DatabaseConfig): void {
  // Store database in user data directory
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, config.filename);

  // Ensure directory exists
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  // Run migrations
  runMigrations(config.migrations);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(migrations: Migration[]): void {
  if (!db) return;

  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const appliedMigrations = (db
    .prepare('SELECT name FROM migrations')
    .all() as { name: string }[])
    .map((row) => row.name);

  for (const migration of migrations) {
    if (!appliedMigrations.includes(migration.name)) {
      console.log(`Running migration: ${migration.name}`);

      const transaction = db.transaction(() => {
        db!.exec(migration.sql);
        db!.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
      });

      try {
        transaction();
      } catch (error) {
        console.error(`Migration ${migration.name} failed:`, error);
        throw error; // Re-throw to prevent app from starting with broken DB
      }
    }
  }
}

// Helper functions for common operations
export function generateId(): string {
  return randomUUID();
}
