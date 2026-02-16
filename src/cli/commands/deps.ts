import { Command } from 'commander';
import type { AppServices } from '../../main/providers/setup';
import { output, type OutputOptions } from '../output';

export function registerDepsCommands(program: Command, getServices: () => AppServices): void {
  const deps = program.command('deps').description('Manage task dependencies');

  deps
    .command('list <taskId>')
    .description('List dependencies for a task')
    .action(async (taskId: string) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const dependencies = await services.taskStore.getDependencies(taskId);
      const rows = dependencies.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
      }));
      output(rows, opts);
    });

  deps
    .command('add <taskId> <depId>')
    .description('Add a dependency')
    .action(async (taskId: string, depId: string) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      await services.taskStore.addDependency(taskId, depId);
      if (opts.json) {
        output({ added: true, taskId, depId }, opts);
      } else if (!opts.quiet) {
        console.log(`Added dependency: ${taskId} depends on ${depId}`);
      }
    });

  deps
    .command('remove <taskId> <depId>')
    .description('Remove a dependency')
    .action(async (taskId: string, depId: string) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      await services.taskStore.removeDependency(taskId, depId);
      if (opts.json) {
        output({ removed: true, taskId, depId }, opts);
      } else if (!opts.quiet) {
        console.log(`Removed dependency: ${taskId} no longer depends on ${depId}`);
      }
    });
}
