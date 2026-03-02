import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import type { AppSettings } from '../../shared/types';
import { output, type OutputOptions } from '../output';
import { handleCliError } from '../error';

export function registerSettingsCommands(program: Command, api: ApiClient): void {
  const settings = program.command('settings').description('Manage application settings');

  settings
    .command('get')
    .alias('show')
    .description('Get current settings')
    .action(async () => {
      const opts = program.opts() as OutputOptions;
      try {
        const result = await api.settings.get();
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get settings');
      }
    });

  settings
    .command('update')
    .description('Update settings')
    .option('--theme <theme>', 'Theme (light|dark|system)')
    .option('--notifications <bool>', 'Enable notifications (true|false)')
    .option('--default-pipeline <id>', 'Default pipeline ID')
    .option('--current-project <id>', 'Current project ID')
    .option('--chat-agent-lib <lib>', 'Default chat agent lib')
    .action(async (cmdOpts: {
      theme?: string;
      notifications?: string;
      defaultPipeline?: string;
      currentProject?: string;
      chatAgentLib?: string;
    }) => {
      const opts = program.opts() as OutputOptions;
      try {
        const updates: Partial<AppSettings> = {};

        if (cmdOpts.theme !== undefined) {
          updates.theme = cmdOpts.theme as AppSettings['theme'];
        }
        if (cmdOpts.notifications !== undefined) {
          updates.notificationsEnabled = cmdOpts.notifications === 'true';
        }
        if (cmdOpts.defaultPipeline !== undefined) {
          updates.defaultPipelineId = cmdOpts.defaultPipeline || null;
        }
        if (cmdOpts.currentProject !== undefined) {
          updates.currentProjectId = cmdOpts.currentProject || null;
        }
        if (cmdOpts.chatAgentLib !== undefined) {
          updates.chatDefaultAgentLib = cmdOpts.chatAgentLib || null;
        }

        const result = await api.settings.update(updates);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to update settings');
      }
    });
}
