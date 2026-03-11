import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { formatFeedbackForPrompt, getInteractiveFields, getInteractiveInstructions, getTaskEstimationFields, getTaskEstimationInstructions } from './prompt-utils';

export class PlannerPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'planner';

  protected isReadOnly(): boolean {
    return true;
  }

  protected getExcludedFeedbackTypes(): string[] {
    return ['plan_feedback'];
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
      // Plan revision (was: plan_revision)
      const prLines: string[] = [];
      if (context.sessionId) {
        prLines.push(
          `Revise the plan based on the feedback below.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
      } else {
        prLines.push(
          `The admin has reviewed the current plan and requested changes. Revise the plan based on their feedback.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
        if (task.plan) {
          prLines.push('', '## Current Plan', task.plan);
        }
      }
      prLines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Admin Feedback'));
      prLines.push(
        '',
        '## Revision Guidelines',
        '- Address every piece of feedback — do not skip or partially address any comment.',
        '- If feedback is ambiguous, interpret it in the most reasonable way and note your interpretation.',
        '- Keep parts of the plan that were not criticized — only revise what the feedback targets.',
        '- **If this revision changes which files are modified or changes the core technical approach** (not just wording or parameter tweaks), re-read the files your new design depends on. Do not rely solely on context from the initial exploration — verify that your new approach works with the actual code.',
        '- Re-assess and include complexity and effort assessments right after the plan title (see Complexity Assessment below).',
        '',
        '## Output Requirements',
        '- The `plan` field must be a CLEAN, standalone plan — as if written from scratch.',
        '  - Do NOT include "(Revised)" in the title.',
        '  - Do NOT include "Changes from Initial Plan", "Addressing Feedback", or any revision commentary.',
        '  - Do NOT include sections explaining what changed or how feedback was addressed.',
        '  - The plan should read as a fresh, authoritative document — not as a diff or changelog.',
        '- The `planSummary` field is where you describe what changed and how you addressed the feedback.',
        '  - This is the ONLY place revision notes belong.',
      );
      prompt = prLines.join('\n');
    } else if (mode === 'revision' && revisionReason === 'info_provided') {
      // Plan resume (was: plan_resume)
      const prLines = context.sessionId
        ? [
            `Continue creating the plan using the user's decisions below.`,
            ``,
            `Task: ${task.title}.${desc}`,
          ]
        : [
            `You are a senior software engineer. Continue creating the implementation plan for this task using the user's decisions.`,
            ``,
            `Task: ${task.title}.${desc}`,
          ];
      prLines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Admin Feedback'));
      prLines.push(
        '',
        '## Instructions',
        '1. Review the user\'s answers to your questions in the Task Context above.',
        '2. Use their decisions to guide your implementation plan.',
        '3. **Explore the codebase** to ground your plan in real file paths and existing patterns. If the task description already includes a detailed design with specific files and data flows, focus exploration on verifying assumptions and identifying gaps rather than rediscovering what was already specified.',
        '4. Produce a complete implementation plan with 3-8 concrete, independently testable subtasks ordered by dependency.',
        '5. List any assumptions about existing code behavior that your plan depends on but does not modify. For each, note whether it is VERIFIED (cite the file and line) or UNVERIFIED.',
        '6. Include complexity and effort assessments right after the plan title (see Complexity Assessment below).',
      );
      prompt = prLines.join('\n');
    } else {
      // New plan (was: plan)
      const planLines = [
        `You are a senior software engineer. Analyze this task and create a detailed implementation plan. Task: ${task.title}.${desc}`,
        ``,
        `## Instructions`,
        `1. **Explore the codebase first.** Read relevant files, understand the directory structure, and identify existing patterns before planning.`,
        `   **Shortcut for pre-designed tasks:** If the task description already includes a detailed design section with specific files to modify, data flow descriptions, and edge cases, adopt the provided design as your plan basis. Focus exploration on verifying assumptions and identifying gaps rather than rediscovering the architecture from scratch. Still produce a complete plan with subtasks, but reference the provided design rather than re-deriving it.`,
        `2. Describe the current state — what exists today and what needs to change.`,
        `3. Outline your approach — the high-level strategy, key decisions, and any alternatives you considered.`,
        `4. List specific files to create or modify, with a short description of each change.`,
        `5. Identify edge cases, error handling, and potential risks. If an edge case requires a code change to handle, include that file in your change list.`,
        `6. List any **assumptions about existing code behavior** that your plan depends on but does not modify. For each, note whether it is VERIFIED (cite the file and line) or UNVERIFIED. The implementor will verify unverified assumptions before starting edits.`,
        `7. Break the plan into 3-8 concrete subtasks. Each subtask should be independently testable and ordered by dependency.`,
        `8. Include complexity and effort assessments right after the plan title (see Complexity Assessment below).`,
        ``,
        `## Multi-Phase Tasks (Optional)`,
        `For large tasks that would result in a massive PR, you can organize subtasks into sequential **implementation phases**.`,
        `Each phase gets its own implementation run and PR. Use phases only when the task is genuinely large (e.g. 10+ files across multiple domains).`,
        `Most tasks should use flat subtasks. If you use phases, provide 2-4 phases with clear boundaries.`,
        `Output phases in the "phases" array field. Each phase has a "name" and its own "subtasks" array.`,
        `When using phases, the "subtasks" field should be empty (subtasks live inside phases).`,
      ];
      planLines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Admin Feedback'));
      prompt = planLines.join('\n');
    }

    prompt += [
      '',
      '',
      '## Complexity Assessment',
      'Right after the plan title and short description, include separate complexity and effort assessments:',
      '',
      '```',
      '## Plan - [TITLE]',
      '[short plan description]',
      '',
      '## Complexity: <Low|Medium|High>',
      '[one-sentence explanation of algorithmic/architectural difficulty]',
      '',
      '## Effort Size: <XS|SM|MD|LG|XL>',
      '[one-sentence explanation of scale/breadth of changes]',
      '```',
      '',
      '**Complexity** (pure code difficulty — NOT number of files):',
      '- **Low**: Straightforward changes, clear path, no tricky edge cases (e.g. adding a field, config change, prompt tweak)',
      '- **Medium**: Some architectural decisions, tricky logic, or cross-cutting concerns to navigate',
      '- **High**: Significant algorithmic challenge, many unknowns, architectural redesign, or complex integration',
      '',
      '**Effort Size** (breadth of changes — NOT algorithmic difficulty):',
      '- **XS**: Trivial, less than 1 file',
      '- **SM**: 1-2 files',
      '- **MD**: 3-5 files',
      '- **LG**: 6-10 files',
      '- **XL**: 10+ files',
      '',
      'Example: Adding a field across 12 files → **Low complexity, XL effort** (not "Large complexity")',
    ].join('\n');

    prompt += getTaskEstimationInstructions();
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
