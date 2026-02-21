import { Command } from 'commander';
import type { AppServices } from '../../main/providers/setup';
import { output, type OutputOptions } from '../output';

interface QuestionOption {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
}

interface Question {
  id: string;
  question: string;
  context?: string;
  options?: QuestionOption[];
}

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

      if (opts.json) {
        output(list, opts);
        return;
      }

      // Human-readable output with question details
      for (const p of list) {
        console.log(`ID: ${p.id}`);
        console.log(`Type: ${p.promptType}`);
        console.log(`Status: ${p.status}`);
        console.log(`Created: ${new Date(p.createdAt).toISOString()}`);

        const questions = parseQuestions(p.payload);
        if (questions.length > 0) {
          console.log('Questions:');
          for (const q of questions) {
            const qType = q.options && q.options.length > 0 ? 'choice' : 'text';
            console.log(`  ${q.id}: ${q.question} [${qType}]`);
            if (q.context) console.log(`      Context: ${q.context}`);
            if (q.options) {
              for (const o of q.options) {
                const rec = o.recommended ? ' (recommended)' : '';
                console.log(`      ${o.id}) ${o.label}${rec}: ${o.description}`);
              }
            }
          }
        }
        console.log('');
      }
    });

  prompts
    .command('respond <id>')
    .description('Respond to a prompt')
    .requiredOption('--response <json>', 'Response JSON (e.g. \'{"answers":[{"questionId":"q1","selectedOptionId":"opt1"}]}\')')
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

function parseQuestions(payload: Record<string, unknown>): Question[] {
  if (!Array.isArray(payload.questions)) return [];
  return payload.questions
    .filter((q): q is Record<string, unknown> => q != null && typeof q === 'object')
    .filter(q => typeof q.id === 'string' && typeof q.question === 'string')
    .map(q => ({
      id: q.id as string,
      question: q.question as string,
      context: typeof q.context === 'string' ? q.context : undefined,
      options: Array.isArray(q.options)
        ? q.options
            .filter((o): o is Record<string, unknown> => o != null && typeof o === 'object')
            .map(o => ({
              id: String(o.id),
              label: String(o.label),
              description: String(o.description ?? ''),
              recommended: o.recommended === true,
            }))
        : undefined,
    }));
}
