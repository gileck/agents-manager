import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseClaudeAgent } from './base-claude-agent';

export class ClaudeCodeAgent extends BaseClaudeAgent {
  readonly type = 'claude-code';

  protected getTimeout(context: AgentContext, config: AgentConfig): number {
    return config.timeout || (context.mode === 'plan' || context.mode === 'plan_revision' ? 5 * 60 * 1000 : 10 * 60 * 1000);
  }

  protected getOutputFormat(context: AgentContext): object | undefined {
    switch (context.mode) {
      case 'plan':
      case 'plan_revision':
        return {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              plan: { type: 'string', description: 'The full implementation plan as markdown' },
              planSummary: { type: 'string', description: 'A short 2-3 sentence summary of the plan for display in task context' },
              subtasks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Concrete implementation steps that break down the plan',
              },
            },
            required: ['plan', 'planSummary', 'subtasks'],
          },
        };
      case 'implement':
        return {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: 'A short summary of the changes implemented' },
            },
            required: ['summary'],
          },
        };
      case 'request_changes':
        return {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: 'A short summary of the fixes made to address reviewer feedback' },
            },
            required: ['summary'],
          },
        };
      default:
        return undefined;
    }
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode } = context;
    const desc = task.description ? ` ${task.description}` : '';

    let prompt: string;
    switch (mode) {
      case 'plan': {
        const planLines = [
          `Analyze this task and create a detailed implementation plan. Task: ${task.title}.${desc}`,
        ];
        if (task.planComments && task.planComments.length > 0) {
          planLines.push('', '## Admin Feedback');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            planLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        planLines.push(
          ``,
          `Your output will be captured as structured JSON with three fields:`,
          `- "plan": the full implementation plan as markdown`,
          `- "planSummary": a short 2-3 sentence summary of the plan`,
          `- "subtasks": an array of concrete implementation step names`,
        );
        prompt = planLines.join('\n');
        break;
      }
      case 'plan_revision': {
        const prLines = [
          `The admin has reviewed the current plan and requested changes. Revise the plan based on their feedback.`,
          ``,
          `Task: ${task.title}.${desc}`,
        ];
        if (task.plan) {
          prLines.push('', '## Current Plan', task.plan);
        }
        if (task.planComments && task.planComments.length > 0) {
          prLines.push('', '## Admin Feedback');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            prLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        prLines.push(
          '',
          'Your output will be captured as structured JSON with three fields:',
          '- "plan": the revised full implementation plan as markdown',
          '- "planSummary": a short 2-3 sentence summary of the revised plan',
          '- "subtasks": an array of concrete implementation step names',
        );
        prompt = prLines.join('\n');
        break;
      }
      case 'implement': {
        const lines = [
          `Implement the changes for this task. After making all changes, stage and commit them with git (git add the relevant files, then git commit with a descriptive message). Task: ${task.title}.${desc}`,
        ];
        if (task.plan) {
          lines.push('', '## Plan', task.plan);
        }
        if (task.planComments && task.planComments.length > 0) {
          lines.push('', '## Plan Comments');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            lines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
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
      case 'request_changes': {
        const rcLines = [
          `A code reviewer has reviewed the changes on this branch and requested changes.`,
          `You MUST address ALL of the reviewer's feedback from the Task Context above.`,
          ``,
          `Task: ${task.title}.${desc}`,
        ];
        if (task.plan) {
          rcLines.push('', '## Plan', task.plan);
        }
        if (task.planComments && task.planComments.length > 0) {
          rcLines.push('', '## Plan Comments');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            rcLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        rcLines.push(
          ``,
          `## Instructions`,
          `1. Read the reviewer's feedback in the Task Context above carefully.`,
          `2. Fix every issue mentioned — do not skip or ignore any feedback.`,
          `3. After making all fixes, stage and commit with a descriptive message.`,
        );
        prompt = rcLines.join('\n');
        break;
      }
      default:
        prompt = `${task.title}.${desc}`;
    }

    // Modes with structured output get their summary via the schema.
    // For other modes, ask for a textual summary section.
    if (!this.getOutputFormat(context)) {
      prompt += '\n\nWhen you are done, end your response with a "## Summary" section that briefly describes what you did.';
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
      case 'plan_revision': return 'plan_complete';
      case 'implement': return 'pr_ready';
      case 'request_changes': return 'pr_ready';
      default: return 'completed';
    }
  }
}
