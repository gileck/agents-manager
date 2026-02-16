import { Command } from 'commander';
import type { AppServices } from '../../main/providers/setup';
import { output, type OutputOptions } from '../output';

export function registerPipelinesCommands(program: Command, getServices: () => AppServices): void {
  const pipelines = program.command('pipelines').description('View pipelines');

  pipelines
    .command('list')
    .alias('ls')
    .description('List all pipelines')
    .action(async () => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const list = await services.pipelineStore.listPipelines();
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
      const services = getServices();
      const pipeline = await services.pipelineStore.getPipeline(id);
      if (!pipeline) {
        console.error(`Pipeline not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      output(pipeline, opts);
    });
}
