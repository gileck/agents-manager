import { Command } from 'commander';
import type { AppServices } from '../../main/providers/setup';
import { output, type OutputOptions } from '../output';

export function registerProjectCommands(program: Command, getServices: () => AppServices): void {
  const projects = program.command('projects').description('Manage projects');

  projects
    .command('list')
    .alias('ls')
    .description('List all projects')
    .action(async () => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const list = await services.projectStore.listProjects();
      const rows = list.map((p) => ({ id: p.id, name: p.name, path: p.path ?? '' }));
      output(rows, opts);
    });

  projects
    .command('get <id>')
    .description('Get project details')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const project = await services.projectStore.getProject(id);
      if (!project) {
        console.error(`Project not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      output(project, opts);
    });

  projects
    .command('create')
    .description('Create a new project')
    .requiredOption('--name <name>', 'Project name')
    .option('--description <desc>', 'Project description')
    .option('--path <path>', 'Project path')
    .action(async (cmdOpts: { name: string; description?: string; path?: string }) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const project = await services.projectStore.createProject({
        name: cmdOpts.name,
        description: cmdOpts.description,
        path: cmdOpts.path,
      });
      output(project, opts);
    });

  projects
    .command('update <id>')
    .description('Update a project')
    .option('--name <name>', 'Project name')
    .option('--description <desc>', 'Project description')
    .option('--path <path>', 'Project path')
    .action(async (id: string, cmdOpts: { name?: string; description?: string; path?: string }) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const project = await services.projectStore.updateProject(id, {
        name: cmdOpts.name,
        description: cmdOpts.description,
        path: cmdOpts.path,
      });
      if (!project) {
        console.error(`Project not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      output(project, opts);
    });

  projects
    .command('delete <id>')
    .description('Delete a project')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const deleted = await services.projectStore.deleteProject(id);
      if (!deleted) {
        console.error(`Project not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        output({ deleted: true, id }, opts);
      } else if (!opts.quiet) {
        console.log(`Deleted project ${id}`);
      }
    });
}
