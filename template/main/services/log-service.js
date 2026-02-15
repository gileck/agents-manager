"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addLogEntry = addLogEntry;
exports.flushLogs = flushLogs;
exports.getLogsByRunId = getLogsByRunId;
exports.deleteLogsByRunId = deleteLogsByRunId;
exports.cleanupOldLogs = cleanupOldLogs;
exports.getLogStats = getLogStats;
const database_1 = require("./database");
// Buffer for batching log writes
const logBuffer = [];
let flushTimer = null;
const FLUSH_INTERVAL = 500; // Flush every 500ms
const MAX_BUFFER_SIZE = 100; // Or when buffer reaches 100 entries
function addLogEntry(runId, level, message) {
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
function flushLogs() {
    if (logBuffer.length === 0)
        return;
    const db = (0, database_1.getDatabase)();
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
    const insertMany = db.transaction((entries) => {
        for (const entry of entries) {
            stmt.run((0, database_1.generateId)(), entry.runId, entry.timestamp, entry.level, entry.message);
        }
    });
    try {
        insertMany(entries);
    }
    catch (error) {
        console.error('Failed to flush logs:', error);
    }
}
function getLogsByRunId(runId, limit = 1000) {
    // Flush any pending logs first
    flushLogs();
    const db = (0, database_1.getDatabase)();
    const rows = db
        .prepare('SELECT * FROM logs WHERE run_id = ? ORDER BY timestamp ASC LIMIT ?')
        .all(runId, limit);
    return rows.map(row => ({
        id: row.id,
        runId: row.run_id,
        timestamp: row.timestamp,
        level: row.level,
        message: row.message,
    }));
}
function deleteLogsByRunId(runId) {
    const db = (0, database_1.getDatabase)();
    db.prepare('DELETE FROM logs WHERE run_id = ?').run(runId);
}
function cleanupOldLogs(retentionDays) {
    if (retentionDays <= 0)
        return 0;
    const db = (0, database_1.getDatabase)();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const result = db
        .prepare('DELETE FROM logs WHERE timestamp < ?')
        .run(cutoffDate.toISOString());
    return result.changes;
}
function getLogStats() {
    const db = (0, database_1.getDatabase)();
    const countResult = db.prepare('SELECT COUNT(*) as count FROM logs').get();
    const oldestResult = db.prepare('SELECT MIN(timestamp) as oldest FROM logs').get();
    const newestResult = db.prepare('SELECT MAX(timestamp) as newest FROM logs').get();
    return {
        totalLogs: countResult.count,
        oldestLog: oldestResult.oldest || undefined,
        newestLog: newestResult.newest || undefined,
    };
}
//# sourceMappingURL=log-service.js.map