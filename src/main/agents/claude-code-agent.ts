import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseClaudeAgent } from './base-claude-agent';

export class ClaudeCodeAgent extends BaseClaudeAgent {
  readonly type = 'claude-code';

  protected getTimeout(context: AgentContext, config: AgentConfig): number {
    return config.timeout || (context.mode === 'plan' ? 5 * 60 * 1000 : 10 * 60 * 1000); // request_changes uses same 10min as implement
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode } = context;
    const desc = task.description ? ` ${task.description}` : '';

    let prompt: string;
    switch (mode) {
      case 'plan':
        prompt = [
          `Analyze this task and create a detailed implementation plan. Task: ${task.title}.${desc}`,
          ``,
          `At the end of your plan, include a "## Subtasks" section with a JSON array of subtask names that break down the implementation into concrete steps. Example:`,
          `## Subtasks`,
          '```json',
          `["Set up database schema", "Implement API endpoint", "Add unit tests"]`,
          '```',
        ].join('\n');
        break;
      case 'implement': {
        const lines = [
          `Implement the changes for this task. After making all changes, stage and commit them with git (git add the relevant files, then git commit with a descriptive message). Task: ${task.title}.${desc}`,
        ];
        if (task.subtasks && task.subtasks.length > 0) {
          lines.push('', '## Subtasks', 'Track your progress by updating subtask status as you work:');
          for (const st of task.subtasks) {
            lines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
          }
          lines.push(
            '',
            `Use the CLI to update subtask status as you complete each step:`,
            `  am tasks subtask update ${task.id} --name "subtask name" --status in_progress`,
            `  am tasks subtask update ${task.id} --name "subtask name" --status done`,
          );
        } else {
          lines.push(
            '',
            `If you want to track progress, create subtasks via CLI:`,
            `  am tasks subtask add ${task.id} --name "step description"`,
          );
        }
        prompt = lines.join('\n');
        break;
      }
      case 'request_changes':
        prompt = [
          `A code reviewer has reviewed the changes on this branch and requested changes.`,
          `You MUST address ALL of the reviewer's feedback from the Task Context above.`,
          ``,
          `Task: ${task.title}.${desc}`,
          ``,
          `## Instructions`,
          `1. Read the reviewer's feedback in the Task Context above carefully.`,
          `2. Fix every issue mentioned — do not skip or ignore any feedback.`,
          `3. After making all fixes, stage and commit with a descriptive message.`,
        ].join('\n');
        break;
      default:
        prompt = `${task.title}.${desc}`;
    }

    prompt += '\n\nWhen you are done, end your response with a "## Summary" section that briefly describes what you did.';

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  inferOutcome(mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    switch (mode) {
      case 'plan': return 'plan_complete';
      case 'implement': return 'pr_ready';
      case 'request_changes': return 'pr_ready';
      default: return 'completed';
    }
  }
}
