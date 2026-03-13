import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { formatFeedbackForPrompt, getInteractiveFields, getInteractiveInstructions, getTaskEstimationFields, getTaskEstimationInstructions } from './prompt-utils';

const COMPLEXITY_AND_ESTIMATION = [
  '',
  '## Complexity & Effort',
  'Include these right after the plan title:',
  '- **Complexity** (code difficulty, NOT file count): Low (straightforward) / Medium (some architectural decisions or tricky logic) / High (significant unknowns or redesign)',
  '- **Effort** (breadth of changes, NOT difficulty): XS (<1 file) / SM (1-2) / MD (3-5) / LG (6-10) / XL (10+)',
  'Example: Adding a field across 12 files → Low complexity, XL effort.',
].join('\n');

const MULTI_PHASE_INSTRUCTIONS = [
  '',
  '## Multi-Phase Tasks',
  'Only for genuinely large tasks (10+ files across multiple domains). Most tasks should use flat subtasks.',
  'If needed, provide 2-4 phases in the "phases" array. When using phases, leave "subtasks" empty.',
].join('\n');

const EFFICIENCY_RULES = [
  '',
  '## Efficiency Rules',
  '- FIRST classify the task, THEN scope your exploration proportionally.',
  '- **Do NOT use the Agent/Task tool to spawn sub-agents.** Read files directly with Read, Grep, and Glob so their contents stay in your context. Sub-agents read files in isolation and force you to re-read everything.',
  '- Read each file AT MOST once. Do not re-read files you have already seen.',
  '- Do not explore files that are unlikely to appear in your change list or inform a key decision (e.g., skip store implementations, daemon routes, and config files for a pure UI task).',
  '- Avoid redundant exploration: if the task description already describes a file\'s role, do not re-read it to confirm what was stated.',
  '- **Turn budget:** Reserve your last 5-10 turns for producing the plan output. The plan is the deliverable — if you have explored enough to form a reasonable plan, stop exploring and write it. An imperfect plan produced on time is better than no plan at all.',
].join('\n');

export class PlannerPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'planner';

  protected isReadOnly(): boolean {
    return true;
  }

  protected getExcludedFeedbackTypes(): string[] {
    return ['plan_feedback'];
  }

  protected getMaxTurns(): number {
    return 50;
  }

  protected getTimeout(_context: AgentContext, config: AgentConfig): number {
    return config.timeout || 7 * 60 * 1000;
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
          ...getTaskEstimationFields(),
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
      prompt = this.buildRevisionPrompt(context, task.title, desc, task.plan);
    } else if (mode === 'revision' && revisionReason === 'info_provided') {
      prompt = this.buildResumePrompt(context, task.title, desc);
    } else {
      prompt = this.buildNewPlanPrompt(context, task.title, desc);
    }

    prompt += COMPLEXITY_AND_ESTIMATION;
    prompt += getTaskEstimationInstructions();
    prompt += getInteractiveInstructions(this.type);

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  private buildNewPlanPrompt(context: AgentContext, title: string, desc: string): string {
    const lines = [
      `You are a senior software engineer. Create an implementation plan for the task below.`,
      ``,
      `**Task:** ${title}.${desc}`,
      ``,
      `## Planning Strategy`,
      ``,
      `Before exploring any code, read the task description above and classify it:`,
      ``,
      `**PRE-DESIGNED** — The description includes specific files to modify, data flows, and/or edge cases.`,
      `→ Do NOT explore from scratch. Make targeted file reads to verify key assumptions, then produce the plan based on the provided design. Most pre-designed tasks need only 5-10 file reads.`,
      ``,
      `**OPEN-ENDED** — The description is a goal without implementation details.`,
      `→ Explore relevant source files to understand current state and patterns. For small/medium tasks, focus on the 5-15 most relevant files. For large cross-cutting tasks, explore as many files as needed to produce a sound plan — but always prioritize files you expect to modify over tangential context.`,
      EFFICIENCY_RULES,
      ``,
      `## Plan Requirements`,
      ``,
      `Produce a plan covering:`,
      `1. **Current state** — what exists today and what needs to change.`,
      `2. **Approach** — high-level strategy, key decisions, and alternatives considered.`,
      `3. **Files to modify** — each file with a short description of the change.`,
      `4. **Edge cases & risks** — and whether each requires a code change (if so, include the file above).`,
      `5. **Assumptions** — mark each VERIFIED (cite file:line) or UNVERIFIED (implementor will verify).`,
      `6. **Subtasks** — 3-8 concrete, independently testable steps ordered by dependency.`,
      MULTI_PHASE_INSTRUCTIONS,
    ];
    lines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Admin Feedback'));
    return lines.join('\n');
  }

  private buildRevisionPrompt(context: AgentContext, title: string, desc: string, plan: string | null | undefined): string {
    const lines: string[] = [];
    if (context.sessionId) {
      lines.push(
        `Revise the plan based on the feedback below.`,
        ``,
        `Task: ${title}.${desc}`,
      );
    } else {
      lines.push(
        `Revise the plan based on admin feedback.`,
        ``,
        `Task: ${title}.${desc}`,
      );
      if (plan) {
        lines.push('', '## Current Plan', plan);
      }
    }
    lines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Admin Feedback'));
    lines.push(
      '',
      '## Revision Guidelines',
      '- Address every piece of feedback — do not skip or partially address any comment.',
      '- If feedback is ambiguous, interpret it reasonably and note your interpretation.',
      '- Keep parts of the plan that were not criticized — only revise what the feedback targets.',
      '- If the revision changes which files are modified or the core technical approach, re-read those files to verify your new approach works.',
      '',
      '## Output Requirements',
      '- The `plan` field must be a CLEAN, standalone plan — as if written from scratch.',
      '  - No "(Revised)" in the title. No "Changes from Initial Plan" or revision commentary.',
      '  - The plan should read as a fresh, authoritative document.',
      '- The `planSummary` field is where you describe what changed and how you addressed the feedback.',
    );
    return lines.join('\n');
  }

  private buildResumePrompt(context: AgentContext, title: string, desc: string): string {
    const lines = context.sessionId
      ? [
          `Continue creating the plan using the user's decisions below.`,
          ``,
          `Task: ${title}.${desc}`,
        ]
      : [
          `Continue creating the implementation plan using the user's decisions below.`,
          ``,
          `Task: ${title}.${desc}`,
        ];
    lines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Admin Feedback'));
    lines.push(
      '',
      '## Instructions',
      '1. Review the user\'s answers to your questions above.',
      '2. Use their decisions to produce a complete implementation plan.',
      '3. If files are already named in the task or your prior exploration, do not re-explore them.',
      '4. Produce 3-8 concrete, independently testable subtasks ordered by dependency.',
      '5. Mark assumptions as VERIFIED (cite file:line) or UNVERIFIED.',
    );
    return lines.join('\n');
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'plan_complete';
  }
}
