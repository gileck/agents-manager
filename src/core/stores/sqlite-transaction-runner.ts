import type Database from 'better-sqlite3';
import type { ITransactionRunner } from '../interfaces/transaction-runner';

export class SqliteTransactionRunner implements ITransactionRunner {
  constructor(private db: Database.Database) {}

  runTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
