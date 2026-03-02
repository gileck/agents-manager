import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import type { TaskEventCategory, ActivityAction, ActivityEntity } from '../../shared/types';
import { output, type OutputOptions } from '../output';
import { handleCliError } from '../error';

export function registerEventsCommands(program: Command, api: ApiClient): void {
  const events = program.command('events').description('View events and activities');

  events
    .command('list')
    .description('List task events')
    .requiredOption('--task <taskId>', 'Task ID')
    .option('--category <cat>', 'Filter by category')
    .action(async (cmdOpts: { task: string; category?: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
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
      } catch (err) {
        handleCliError(err, 'Failed to list events');
      }
    });

  events
    .command('activities')
    .description('List activity log entries')
    .option('--action <action>', 'Filter by action')
    .option('--entity-type <type>', 'Filter by entity type')
    .option('--entity-id <id>', 'Filter by entity ID')
    .option('--limit <n>', 'Maximum number of results', parseInt)
    .action(async (cmdOpts: {
      action?: string;
      entityType?: string;
      entityId?: string;
      limit?: number;
    }) => {
      const opts = program.opts() as OutputOptions;
      try {
        const list = await api.events.listActivities({
          action: cmdOpts.action as ActivityAction | undefined,
          entityType: cmdOpts.entityType as ActivityEntity | undefined,
          entityId: cmdOpts.entityId,
          limit: cmdOpts.limit,
        }) as {
          id: string;
          action: string;
          entityType: string;
          entityId: string;
          summary: string;
          createdAt: number;
        }[];
        const rows = list.map((a) => ({
          id: a.id,
          action: a.action,
          entityType: a.entityType,
          entityId: a.entityId,
          summary: a.summary,
          createdAt: new Date(a.createdAt).toISOString(),
        }));
        output(rows, opts);
      } catch (err) {
        handleCliError(err, 'Failed to list activities');
      }
    });
}
