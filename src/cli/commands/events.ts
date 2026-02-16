import { Command } from 'commander';
import type { AppServices } from '../../main/providers/setup';
import type { TaskEventCategory } from '../../shared/types';
import { output, type OutputOptions } from '../output';

export function registerEventsCommands(program: Command, getServices: () => AppServices): void {
  const events = program.command('events').description('View task events');

  events
    .command('list')
    .description('List events')
    .requiredOption('--task <taskId>', 'Task ID')
    .option('--category <cat>', 'Filter by category')
    .action(async (cmdOpts: { task: string; category?: string }) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const list = await services.taskEventLog.getEvents({
        taskId: cmdOpts.task,
        category: cmdOpts.category as TaskEventCategory | undefined,
      });
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
