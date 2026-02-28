import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { getInteractiveFields, getInteractiveInstructions } from './prompt-utils';

export class PlannerPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'planner';

  protected isReadOnly(): boolean {
    return true;
  }

  protected getMaxTurns(): number {
    return 150;
  }

  protected getTimeout(_context: AgentContext, config: AgentConfig): number {
    return config.timeout || 10 * 60 * 1000;
  }

  protected getOutputFormat(): object {
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
            description: 'Concrete implementation steps that break down the plan. Use this for single-phase tasks (most tasks).',
          },
          phases: {
            type: 'array',
            description: 'Optional: For large tasks that should be implemented in multiple sequential phases, each with its own PR. Only use when the task is genuinely large enough to warrant separate PRs. Most tasks should use flat subtasks instead.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Phase name, e.g. "Phase 1: Data Model & Migration"' },
                subtasks: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Subtasks belonging to this phase',
                },
              },
              required: ['name', 'subtasks'],
            },
          },
          ...getInteractiveFields(),
        },
        required: ['plan', 'planSummary', 'subtasks'],
      },
    };
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode, revisionReason } = context;
    const desc = task.description ? ` ${task.description}` : '';

    let prompt: string;

    if (mode === 'revision' && revisionReason === 'changes_requested') {
      // Plan revision (was: plan_revision)
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
        '## Revision Guidelines',
        '- Address every piece of feedback — do not skip or partially address any comment.',
        '- If feedback is ambiguous, interpret it in the most reasonable way and note your interpretation.',
        '- Keep parts of the plan that were not criticized — only revise what the feedback targets.',
      );
      prompt = prLines.join('\n');
    } else if (mode === 'revision' && revisionReason === 'info_provided') {
      // Plan resume (was: plan_resume)
      const prLines = [
        `You are a senior software engineer. Continue creating the implementation plan for this task using the user's decisions.`,
        ``,
        `Task: ${task.title}.${desc}`,
      ];
      if (task.planComments && task.planComments.length > 0) {
        prLines.push('', '## Admin Feedback');
        for (const comment of task.planComments) {
          const time = new Date(comment.createdAt).toLocaleString();
          prLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
        }
      }
      prLines.push(
        '',
        '## Instructions',
        '1. Review the user\'s answers to your questions in the Task Context above.',
        '2. Use their decisions to guide your implementation plan.',
        '3. **Explore the codebase** to ground your plan in real file paths and existing patterns.',
        '4. Produce a complete implementation plan with 3-8 concrete, independently testable subtasks ordered by dependency.',
      );
      prompt = prLines.join('\n');
    } else {
      // New plan (was: plan)
      const planLines = [
        `You are a senior software engineer. Analyze this task and create a detailed implementation plan. Task: ${task.title}.${desc}`,
        ``,
        `## Instructions`,
        `1. **Explore the codebase first.** Read relevant files, understand the directory structure, and identify existing patterns before planning.`,
        `2. Describe the current state — what exists today and what needs to change.`,
        `3. Outline your approach — the high-level strategy, key decisions, and any alternatives you considered.`,
        `4. List specific files to create or modify, with a short description of each change.`,
        `5. Identify edge cases, error handling, and potential risks.`,
        `6. Break the plan into 3-8 concrete subtasks. Each subtask should be independently testable and ordered by dependency.`,
        ``,
        `## Multi-Phase Tasks (Optional)`,
        `For large tasks that would result in a massive PR, you can organize subtasks into sequential **implementation phases**.`,
        `Each phase gets its own implementation run and PR. Use phases only when the task is genuinely large (e.g. 10+ files across multiple domains).`,
        `Most tasks should use flat subtasks. If you use phases, provide 2-4 phases with clear boundaries.`,
        `Output phases in the "phases" array field. Each phase has a "name" and its own "subtasks" array.`,
        `When using phases, the "subtasks" field should be empty (subtasks live inside phases).`,
      ];
      if (task.planComments && task.planComments.length > 0) {
        planLines.push('', '## Admin Feedback');
        for (const comment of task.planComments) {
          const time = new Date(comment.createdAt).toLocaleString();
          planLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
        }
      }
      prompt = planLines.join('\n');
    }

    prompt += getInteractiveInstructions(this.type);

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'plan_complete';
  }
}
