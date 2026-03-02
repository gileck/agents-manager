import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import { output, type OutputOptions } from '../output';
import { requireProject } from '../context';
import { handleCliError } from '../error';

export function registerFeatureCommands(program: Command, api: ApiClient): void {
  const features = program.command('features').description('Manage features');

  features
    .command('list')
    .alias('ls')
    .description('List features')
    .action(async () => {
      const opts = program.opts() as OutputOptions & { project?: string };
      try {
        const project = await requireProject(api, opts.project);
        const list = await api.features.list({ projectId: project.id });
        const rows = list.map((f) => ({
          id: f.id,
          title: f.title,
          description: f.description ?? '',
          createdAt: new Date(f.createdAt).toISOString(),
        }));
        output(rows, opts);
      } catch (err) {
        handleCliError(err, 'Failed to list features');
      }
    });

  features
    .command('get <id>')
    .alias('show')
    .description('Get feature details')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        const feature = await api.features.get(id);
        output(feature, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get feature');
      }
    });

  features
    .command('create')
    .description('Create a new feature')
    .requiredOption('--title <title>', 'Feature title')
    .option('--description <desc>', 'Feature description')
    .action(async (cmdOpts: { title: string; description?: string }) => {
      const opts = program.opts() as OutputOptions & { project?: string };
      try {
        const project = await requireProject(api, opts.project);
        const feature = await api.features.create({
          projectId: project.id,
          title: cmdOpts.title,
          description: cmdOpts.description,
        });
        output(feature, opts);
      } catch (err) {
        handleCliError(err, 'Failed to create feature');
      }
    });

  features
    .command('update <id>')
    .description('Update a feature')
    .option('--title <title>', 'Feature title')
    .option('--description <desc>', 'Feature description')
    .action(async (id: string, cmdOpts: { title?: string; description?: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        const feature = await api.features.update(id, {
          title: cmdOpts.title,
          description: cmdOpts.description,
        });
        output(feature, opts);
      } catch (err) {
        handleCliError(err, 'Failed to update feature');
      }
    });

  features
    .command('delete <id>')
    .description('Delete a feature')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        await api.features.delete(id);
        if (opts.json) {
          output({ deleted: true, id }, opts);
        } else if (!opts.quiet) {
          console.log(`Deleted feature ${id}`);
        }
      } catch (err) {
        handleCliError(err, 'Failed to delete feature');
      }
    });
}
