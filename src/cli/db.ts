import { openDatabase as openCoreDatabase } from '../core/db';
import { createAppServices, type AppServices } from '../core/providers/setup';
import type Database from 'better-sqlite3';

export function openDatabase(flagPath?: string): { db: Database.Database; services: AppServices } {
  const db = openCoreDatabase({
    dbPath: flagPath,
  });

  const services = createAppServices(db);
  return { db, services };
}
