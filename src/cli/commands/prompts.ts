import { Command } from 'commander';
import type { AppServices } from '../../main/providers/setup';
import { output, type OutputOptions } from '../output';

export function registerPromptsCommands(program: Command, getServices: () => AppServices): void {
  const prompts = program.command('prompts').description('Manage agent prompts');

  prompts
    .command('list')
    .description('List pending prompts')
    .requiredOption('--task <taskId>', 'Task ID')
    .action(async (cmdOpts: { task: string }) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const list = await services.pendingPromptStore.getPendingForTask(cmdOpts.task);
      const rows = list.map((p) => ({
        id: p.id,
        type: p.promptType,
        status: p.status,
        createdAt: new Date(p.createdAt).toISOString(),
      }));
      output(rows, opts);
    });

  prompts
    .command('respond <id>')
    .description('Respond to a prompt')
    .requiredOption('--response <json>', 'Response JSON')
    .action(async (id: string, cmdOpts: { response: string }) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(cmdOpts.response);
      } catch {
        console.error('Invalid JSON for --response');
        process.exitCode = 1;
        return;
      }
      const prompt = await services.workflowService.respondToPrompt(id, parsed);
      if (!prompt) {
        console.error(`Prompt not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      output(prompt, opts);
    });
}
