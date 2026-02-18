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
        prompt = `Analyze this task and create a detailed implementation plan. Task: ${task.title}.${desc}`;
        break;
      case 'implement':
        prompt = `Implement the changes for this task. After making all changes, stage and commit them with git (git add the relevant files, then git commit with a descriptive message). Task: ${task.title}.${desc}`;
        break;
      case 'request_changes':
        prompt = [
          `A code reviewer has reviewed the changes on this branch and requested changes.`,
          `You MUST address ALL of the reviewer's feedback. Do not skip any issue.`,
          ``,
          `Task: ${task.title}.${desc}`,
          ``,
          `## Reviewer Feedback`,
          ``,
          context.previousOutput || '(no review output available)',
          ``,
          `## Instructions`,
          ``,
          `1. Read the reviewer's feedback above carefully.`,
          `2. Fix every issue mentioned — do not skip or ignore any feedback.`,
          `3. After making all fixes, stage and commit with a descriptive message summarizing what was fixed.`,
        ].join('\n');
        break;
      default:
        prompt = `${task.title}.${desc}`;
    }

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
