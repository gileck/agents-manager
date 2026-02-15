import { getDatabase, generateId } from './database';

export interface LogEntry {
  id: string;
  runId: string;
  timestamp: string;
  level: string;
  message: string;
}

// Buffer for batching log writes
const logBuffer: {
  runId: string;
  level: string;
  message: string;
  timestamp: string;
}[] = [];

let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_INTERVAL = 500; // Flush every 500ms
const MAX_BUFFER_SIZE = 100; // Or when buffer reaches 100 entries

export function addLogEntry(
  runId: string,
  level: 'stdout' | 'stderr' | 'info' | 'error',
  message: string
): void {
  logBuffer.push({
    runId,
    level,
    message,
    timestamp: new Date().toISOString(),
  });

  // Flush if buffer is full
  if (logBuffer.length >= MAX_BUFFER_SIZE) {
    flushLogs();
  }

  // Set up flush timer if not already set
  if (!flushTimer) {
    flushTimer = setTimeout(flushLogs, FLUSH_INTERVAL);
  }
}

export function flushLogs(): void {
  if (logBuffer.length === 0) return;

  const db = getDatabase();
  const entries = [...logBuffer];
  logBuffer.length = 0;

  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const stmt = db.prepare(`
    INSERT INTO logs (id, run_id, timestamp, level, message)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((entries: typeof logBuffer) => {
    for (const entry of entries) {
      stmt.run(generateId(), entry.runId, entry.timestamp, entry.level, entry.message);
    }
  });

  try {
    insertMany(entries);
  } catch (error) {
    console.error('Failed to flush logs:', error);
  }
}

export function getLogsByRunId(runId: string, limit = 1000): LogEntry[] {
  // Flush any pending logs first
  flushLogs();

  const db = getDatabase();
  const rows = db
    .prepare('SELECT * FROM logs WHERE run_id = ? ORDER BY timestamp ASC LIMIT ?')
    .all(runId, limit) as any[];

  return rows.map(row => ({
    id: row.id,
    runId: row.run_id,
    timestamp: row.timestamp,
    level: row.level,
    message: row.message,
  }));
}

export function deleteLogsByRunId(runId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM logs WHERE run_id = ?').run(runId);
}

export function cleanupOldLogs(retentionDays: number): number {
  if (retentionDays <= 0) return 0;

  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

  const result = db
    .prepare('DELETE FROM logs WHERE timestamp < ?')
    .run(cutoffDate.toISOString());

  return result.changes;
}

export function getLogStats(): {
  totalLogs: number;
  oldestLog?: string;
  newestLog?: string;
} {
  const db = getDatabase();

  const countResult = db.prepare('SELECT COUNT(*) as count FROM logs').get() as { count: number };
  const oldestResult = db.prepare('SELECT MIN(timestamp) as oldest FROM logs').get() as { oldest: string | null };
  const newestResult = db.prepare('SELECT MAX(timestamp) as newest FROM logs').get() as { newest: string | null };

  return {
    totalLogs: countResult.count,
    oldestLog: oldestResult.oldest || undefined,
    newestLog: newestResult.newest || undefined,
  };
}
