export interface LogEntry {
    id: string;
    runId: string;
    timestamp: string;
    level: string;
    message: string;
}
export declare function addLogEntry(runId: string, level: 'stdout' | 'stderr' | 'info' | 'error', message: string): void;
export declare function flushLogs(): void;
export declare function getLogsByRunId(runId: string, limit?: number): LogEntry[];
export declare function deleteLogsByRunId(runId: string): void;
export declare function cleanupOldLogs(retentionDays: number): number;
export declare function getLogStats(): {
    totalLogs: number;
    oldestLog?: string;
    newestLog?: string;
};
//# sourceMappingURL=log-service.d.ts.map