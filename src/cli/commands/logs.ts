import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import type { AppLogLevel } from '../../shared/types';
import { output, type OutputOptions } from '../output';

export function registerLogsCommands(program: Command, api: ApiClient): void {
  const logs = program.command('logs').description('View and manage app debug logs');

  logs
    .command('list')
    .description('List debug log entries')
    .option('--level <level>', 'Filter by level (debug, info, warn, error)')
    .option('--source <source>', 'Filter by source')
    .option('--search <text>', 'Search in message text')
    .option('--limit <n>', 'Max entries to return', '50')
    .action(async (cmdOpts: { level?: string; source?: string; search?: string; limit: string }) => {
      const opts = program.opts() as OutputOptions;
      const limit = parseInt(cmdOpts.limit, 10);
      if (isNaN(limit) || limit <= 0) {
        console.error('Invalid --limit value. Must be a positive integer.');
        process.exitCode = 1;
        return;
      }
      const entries = await api.debugLogs.list({
        level: cmdOpts.level as AppLogLevel | undefined,
        source: cmdOpts.source,
        search: cmdOpts.search,
        limit,
      });
      const rows = entries.map((e) => ({
        id: e.id.slice(0, 8),
        level: e.level,
        source: e.source,
        message: e.message.length > 80 ? e.message.slice(0, 77) + '...' : e.message,
        createdAt: new Date(e.createdAt).toISOString(),
      }));
      output(rows, opts);
    });

  logs
    .command('clear')
    .description('Clear debug log entries')
    .option('--older-than <days>', 'Only delete entries older than N days')
    .action(async (cmdOpts: { olderThan?: string }) => {
      let olderThanMs: number | undefined;
      if (cmdOpts.olderThan) {
        const days = parseInt(cmdOpts.olderThan, 10);
        if (isNaN(days) || days <= 0) {
          console.error('Invalid --older-than value. Must be a positive integer (days).');
          process.exitCode = 1;
          return;
        }
        olderThanMs = days * 24 * 60 * 60 * 1000;
      }
      const result = await api.debugLogs.clear(olderThanMs);
      console.log(`Deleted ${result.deleted} log entries.`);
    });
}
