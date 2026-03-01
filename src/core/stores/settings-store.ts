import type Database from 'better-sqlite3';
import type { ISettingsStore } from '../interfaces/settings-store';

export class SqliteSettingsStore implements ISettingsStore {
  constructor(private db: Database.Database) {}

  get(key: string, defaultValue: string = ''): string {
    try {
      const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return row?.value ?? defaultValue;
    } catch (err) {
      console.error('SqliteSettingsStore.get failed:', err);
      return defaultValue;
    }
  }

  set(key: string, value: string): void {
    try {
      this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    } catch (err) {
      console.error('SqliteSettingsStore.set failed:', err);
      throw err;
    }
  }

  getAll(): Record<string, string> {
    try {
      const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
      const settings: Record<string, string> = {};
      for (const row of rows) {
        settings[row.key] = row.value;
      }
      return settings;
    } catch (err) {
      console.error('SqliteSettingsStore.getAll failed:', err);
      throw err;
    }
  }

  setMany(updates: Record<string, string>): void {
    try {
      const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
      const runAll = this.db.transaction(() => {
        for (const [key, value] of Object.entries(updates)) {
          stmt.run(key, value);
        }
      });
      runAll();
    } catch (err) {
      console.error('SqliteSettingsStore.setMany failed:', err);
      throw err;
    }
  }
}
