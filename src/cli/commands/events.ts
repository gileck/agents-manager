import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import type { TaskEventCategory } from '../../shared/types';
import { output, type OutputOptions } from '../output';

export function registerEventsCommands(program: Command, api: ApiClient): void {
  const events = program.command('events').description('View task events');

  events
    .command('list')
    .description('List events')
    .requiredOption('--task <taskId>', 'Task ID')
    .option('--category <cat>', 'Filter by category')
    .action(async (cmdOpts: { task: string; category?: string }) => {
      const opts = program.opts() as OutputOptions;
      const list = await api.events.list({
        taskId: cmdOpts.task,
        category: cmdOpts.category as TaskEventCategory | undefined,
      }) as { id: string; category: string; severity: string; message: string; createdAt: number }[];
      const rows = list.map((e) => ({
        id: e.id,
        category: e.category,
        severity: e.severity,
        message: e.message,
        createdAt: new Date(e.createdAt).toISOString(),
      }));
      output(rows, opts);
    });
}
