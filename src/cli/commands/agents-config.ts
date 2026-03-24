import { Command } from 'commander';
// eslint-disable-next-line no-restricted-imports -- agents config commands are daemon-independent (filesystem only, like daemon commands)
import { initAgentFiles, showAgentConfig } from '../../core/agents/agent-file-config-writer';
// eslint-disable-next-line no-restricted-imports -- agents config commands are daemon-independent (filesystem only, like daemon commands)
import { AGENT_BUILDERS } from '../../core/agents/agent-builders';
import type { AgentMode, RevisionReason } from '../../shared/types';

/**
 * Register `agents` CLI commands. These are daemon-independent (filesystem only).
 */
export function registerAgentsConfigCommands(program: Command): void {
  const agents = program
    .command('agents')
    .description('Manage file-based agent configuration (.agents/)');

  agents
    .command('init [agentType]')
    .description('Scaffold .agents/ directory with default prompt and config files')
    .option('--path <path>', 'Project path (defaults to CWD)', process.cwd())
    .option('--force', 'Overwrite existing files', false)
    .action((agentType: string | undefined, opts: { path: string; force: boolean }) => {
      try {
        const result = initAgentFiles(opts.path, agentType, { force: opts.force });

        if (result.created.length > 0) {
          console.log('Created:');
          for (const f of result.created) {
            console.log(`  ${f}`);
          }
        }
        if (result.skipped.length > 0) {
          console.log('Skipped (already exist):');
          for (const f of result.skipped) {
            console.log(`  ${f}`);
          }
        }
        if (result.created.length === 0 && result.skipped.length === 0) {
          console.log('Nothing to do.');
        }

        const types = agentType ? [agentType] : Object.keys(AGENT_BUILDERS);
        console.log(`\nInitialized ${types.length} agent type(s) in ${opts.path}/.agents/`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });

  agents
    .command('show <agentType>')
    .description('Display effective agent prompt and config with source attribution')
    .option('--path <path>', 'Project path (defaults to CWD)', process.cwd())
    .option('--mode <mode>', 'Agent mode (new or revision)', 'new')
    .option('--revision-reason <reason>', 'Revision reason (changes_requested, merge_failed, info_provided, uncommitted_changes)')
    .option('--prompt-only', 'Show only the prompt (no config)', false)
    .option('--config-only', 'Show only the config (no prompt)', false)
    .action((agentType: string, opts: { path: string; mode: string; revisionReason?: string; promptOnly: boolean; configOnly: boolean }) => {
      try {
        const result = showAgentConfig(opts.path, agentType, {
          mode: opts.mode as AgentMode,
          revisionReason: opts.revisionReason as RevisionReason | undefined,
        });

        if (!opts.configOnly) {
          console.log(`## Prompt (source: ${result.promptSource})`);
          console.log('');
          console.log(result.prompt);
          console.log('');
        }

        if (!opts.promptOnly) {
          console.log(`## Config`);
          for (const [key, value] of Object.entries(result.config)) {
            const source = result.configSources[key] ?? 'default';
            console.log(`  ${key}: ${JSON.stringify(value)} (${source})`);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${message}`);
        process.exitCode = 1;
      }
    });

  agents
    .command('list')
    .description('List all available agent types')
    .action(() => {
      const types = Object.keys(AGENT_BUILDERS);
      console.log('Available agent types:');
      for (const type of types) {
        console.log(`  ${type}`);
      }
    });
}
