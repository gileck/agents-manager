import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import { output, type OutputOptions } from '../output';

export function registerPipelinesCommands(program: Command, api: ApiClient): void {
  const pipelines = program.command('pipelines').description('View pipelines');

  pipelines
    .command('list')
    .alias('ls')
    .description('List all pipelines')
    .action(async () => {
      const opts = program.opts() as OutputOptions;
      const list = await api.pipelines.list();
      const rows = list.map((p) => ({
        id: p.id,
        name: p.name,
        taskType: p.taskType,
        statuses: p.statuses.map((s) => s.name).join(', '),
      }));
      output(rows, opts);
    });

  pipelines
    .command('get <id>')
    .description('Get pipeline details')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        const pipeline = await api.pipelines.get(id);
        output(pipeline, opts);
      } catch {
        console.error(`Pipeline not found: ${id}`);
        process.exitCode = 1;
      }
    });
}
