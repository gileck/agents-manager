import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import { requireProject } from '../context';

export function registerTelegramCommands(program: Command, api: ApiClient): void {
  const telegram = program.command('telegram').description('Telegram bot integration');

  telegram
    .command('start')
    .description('Start the Telegram bot (via daemon)')
    .action(async () => {
      const opts = program.opts() as { project?: string };
      const project = await requireProject(api, opts.project);

      try {
        await api.telegram.start(project.id);
        console.log(`Telegram bot started for project "${project.name}".`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  telegram
    .command('stop')
    .description('Stop the Telegram bot')
    .action(async () => {
      const opts = program.opts() as { project?: string };
      const project = await requireProject(api, opts.project);

      try {
        await api.telegram.stop(project.id);
        console.log('Telegram bot stopped.');
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  telegram
    .command('status')
    .description('Show Telegram bot status')
    .action(async () => {
      const opts = program.opts() as { project?: string };
      const project = await requireProject(api, opts.project);

      try {
        const status = await api.telegram.getStatus(project.id);
        console.log(`Project: ${project.name}`);
        console.log(`Status: ${status.running ? 'running' : 'not running'}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
