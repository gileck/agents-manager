import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getMigrations } from './migrations';

const DEFAULT_DB_PATH = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'agents-manager',
  'agents-manager.db',
);

export interface OpenDatabaseOptions {
  /** Explicit path to the database file. Overrides AM_DB_PATH env var and default. */
  dbPath?: string;
  /** Path to the better-sqlite3 native binding. Overrides BETTER_SQLITE3_BINDING env var. */
  nativeBinding?: string;
}

/**
 * Resolves the database file path from (in priority order):
 * 1. Explicit `dbPath` option
 * 2. AM_DB_PATH environment variable
 * 3. Default macOS Application Support path
 */
export function resolveDbPath(dbPath?: string): string {
  if (dbPath) return dbPath;
  if (process.env.AM_DB_PATH) return process.env.AM_DB_PATH;
  return DEFAULT_DB_PATH;
}

/**
 * Auto-resolve the Node-compatible better-sqlite3 native binding.
 * Prefers the BETTER_SQLITE3_BINDING env var (set by bootstrap-cli.js),
 * but falls back to locating build-node/ via require.resolve so the CLI
 * works in worktrees and other contexts where the env var isn't set.
 */
function resolveNativeBinding(): string | undefined {
  if (process.env.BETTER_SQLITE3_BINDING) return process.env.BETTER_SQLITE3_BINDING;

  try {
    const pkgDir = path.dirname(require.resolve('better-sqlite3/package.json'));
    const nodeBinding = path.join(pkgDir, 'build-node', 'Release', 'better_sqlite3.node');
    if (fs.existsSync(nodeBinding)) return nodeBinding;
  } catch (err: unknown) {
    // MODULE_NOT_FOUND is expected when better-sqlite3 isn't installed;
    // anything else (EACCES, ELOOP, etc.) is worth surfacing.
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'MODULE_NOT_FOUND') {
      console.warn(`[core/db] resolveNativeBinding: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return undefined;
}

/**
 * Runs all pending migrations on the database.
 */
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

/**
 * Opens (or creates) the SQLite database, enables WAL mode and foreign keys,
 * and runs all pending migrations.
 *
 * Shared by the daemon, CLI, and test infrastructure.
 */
export function openDatabase(options: OpenDatabaseOptions = {}): Database.Database {
  const dbPath = resolveDbPath(options.dbPath);

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const nativeBinding = options.nativeBinding ?? resolveNativeBinding();

  const db = new Database(dbPath, { nativeBinding });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}
