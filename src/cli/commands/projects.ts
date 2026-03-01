import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import { output, type OutputOptions } from '../output';

export function registerProjectCommands(program: Command, api: ApiClient): void {
  const projects = program.command('projects').description('Manage projects');

  projects
    .command('list')
    .alias('ls')
    .description('List all projects')
    .action(async () => {
      const opts = program.opts() as OutputOptions;
      const list = await api.projects.list();
      const rows = list.map((p) => ({ id: p.id, name: p.name, path: p.path ?? '' }));
      output(rows, opts);
    });

  projects
    .command('get <id>')
    .description('Get project details')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        const project = await api.projects.get(id);
        output(project, opts);
      } catch {
        console.error(`Project not found: ${id}`);
        process.exitCode = 1;
      }
    });

  projects
    .command('create')
    .description('Create a new project')
    .requiredOption('--name <name>', 'Project name')
    .option('--description <desc>', 'Project description')
    .option('--path <path>', 'Project path')
    .action(async (cmdOpts: { name: string; description?: string; path?: string }) => {
      const opts = program.opts() as OutputOptions;
      const project = await api.projects.create({
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
      try {
        const project = await api.projects.update(id, {
          name: cmdOpts.name,
          description: cmdOpts.description,
          path: cmdOpts.path,
        });
        output(project, opts);
      } catch {
        console.error(`Project not found: ${id}`);
        process.exitCode = 1;
      }
    });

  projects
    .command('delete <id>')
    .description('Delete a project')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        await api.projects.delete(id);
        if (opts.json) {
          output({ deleted: true, id }, opts);
        } else if (!opts.quiet) {
          console.log(`Deleted project ${id}`);
        }
      } catch {
        console.error(`Project not found: ${id}`);
        process.exitCode = 1;
      }
    });
}
