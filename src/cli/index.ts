#!/usr/bin/env node

import { Command } from 'commander';
import { createApiClient, ApiError } from '../client/api-client';
import { ensureDaemon } from './ensure-daemon';
import { registerProjectCommands } from './commands/projects';
import { registerTaskCommands } from './commands/tasks';
import { registerAgentCommands } from './commands/agent';
import { registerDepsCommands } from './commands/deps';
import { registerEventsCommands } from './commands/events';
import { registerPromptsCommands } from './commands/prompts';
import { registerPipelinesCommands } from './commands/pipelines';
import { registerStatusCommand } from './commands/status';
import { registerTelegramCommands } from './commands/telegram';
import { registerDaemonCommands } from './commands/daemon';
import { registerAgentsConfigCommands } from './commands/agents-config';
import { registerLogsCommands } from './commands/logs';
import { registerGitCommands } from './commands/git';
import { registerFeatureCommands } from './commands/features';
import { registerSettingsCommands } from './commands/settings';

const program = new Command();

program
  .name('agents-manager')
  .description('Agents Manager CLI')
  .version('1.0.0')
  .option('--project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Minimal output (IDs only)')
  .option('--verbose', 'Verbose output')
  .option('--no-color', 'Disable colored output');

async function main(): Promise<void> {
  // Daemon and agents-config commands manage their own concerns directly —
  // they don't need the daemon API client. Register them before auto-start.
  registerDaemonCommands(program);
  registerAgentsConfigCommands(program);

  // Peek at argv to see if the user is running a daemon or agents sub-command.
  // If so, skip the ensureDaemon() step entirely.
  const isDaemonCommand = process.argv.length >= 3 && process.argv[2] === 'daemon';
  const isAgentsConfigCommand = process.argv.length >= 3 && process.argv[2] === 'agents';
  const isHelpOrVersion = process.argv.includes('--help') || process.argv.includes('-h')
    || process.argv.includes('--version') || process.argv.includes('-V');

  if (!isDaemonCommand && !isAgentsConfigCommand && !isHelpOrVersion) {
    // Ensure the daemon is running and create the API client
    const daemonUrl = await ensureDaemon();
    const api = createApiClient(daemonUrl);

    // Register all API-backed commands
    registerProjectCommands(program, api);
    registerTaskCommands(program, api);
    registerAgentCommands(program, api);
    registerDepsCommands(program, api);
    registerEventsCommands(program, api);
    registerPromptsCommands(program, api);
    registerPipelinesCommands(program, api);
    registerStatusCommand(program, api);
    registerTelegramCommands(program, api);
    registerLogsCommands(program, api);
    registerGitCommands(program, api);
    registerFeatureCommands(program, api);
    registerSettingsCommands(program, api);
  }

  await program.parseAsync(process.argv);
}

// Run
main().catch((err: unknown) => {
  if (err instanceof ApiError) {
    console.error(`API error (${err.status}): ${err.message}`);
  } else if (err instanceof Error) {
    console.error(err.message);
  } else {
    console.error(String(err));
  }
  process.exitCode = 1;
});
