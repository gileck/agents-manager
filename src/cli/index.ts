#!/usr/bin/env node

import { Command } from 'commander';
import { openDatabase } from './db';
import type { AppServices } from '../core/providers/setup';
import { registerProjectCommands } from './commands/projects';
import { registerTaskCommands } from './commands/tasks';
import { registerAgentCommands } from './commands/agent';
import { registerDepsCommands } from './commands/deps';
import { registerEventsCommands } from './commands/events';
import { registerPromptsCommands } from './commands/prompts';
import { registerPipelinesCommands } from './commands/pipelines';
import { registerStatusCommand } from './commands/status';
import { registerTelegramCommands } from './commands/telegram';
import { initShellEnv } from '../core/services/shell-env';

const program = new Command();

program
  .name('agents-manager')
  .description('Agents Manager CLI')
  .version('1.0.0')
  .option('--project <id>', 'Project ID')
  .option('--json', 'Output as JSON')
  .option('--quiet', 'Minimal output (IDs only)')
  .option('--verbose', 'Verbose output')
  .option('--no-color', 'Disable colored output')
  .option('--db <path>', 'Database path');

let _services: AppServices | null = null;
let _db: import('better-sqlite3').Database | null = null;

function getServices(): AppServices {
  if (!_services) {
    const opts = program.opts() as { db?: string };
    const result = openDatabase(opts.db);
    _db = result.db;
    _services = result.services;
  }
  return _services;
}

// Register all commands
registerProjectCommands(program, getServices);
registerTaskCommands(program, getServices);
registerAgentCommands(program, getServices);
registerDepsCommands(program, getServices);
registerEventsCommands(program, getServices);
registerPromptsCommands(program, getServices);
registerPipelinesCommands(program, getServices);
registerStatusCommand(program, getServices);
registerTelegramCommands(program, getServices);

// Eagerly warm the shell PATH cache so git/gh commands find the right binaries.
// Fire-and-forget: the synchronous fallback in getUserShellPath() handles cold cache.
void initShellEnv();

// Run
program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
}).finally(() => {
  if (_db) {
    _db.close();
  }
});
