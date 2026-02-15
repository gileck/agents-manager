import type { Migration } from '@template/main/services/database';

export function getMigrations(): Migration[] {
  return [
    {
      name: '001_create_items',
      sql: `
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `,
    },
    {
      name: '002_create_settings',
      sql: `
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        -- Insert default settings
        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('theme', 'system'),
          ('notifications_enabled', 'true')
      `,
    },
    {
      name: '003_create_logs',
      sql: `
        CREATE TABLE IF NOT EXISTS logs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          level TEXT NOT NULL DEFAULT 'info',
          message TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_logs_run_id ON logs(run_id);
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)
      `,
    },
  ];
}
