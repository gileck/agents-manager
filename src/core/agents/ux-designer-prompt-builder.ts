import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { formatFeedbackForPrompt, getInteractiveFields, getInteractiveInstructions, getTaskEstimationFields, getTaskEstimationInstructions } from './prompt-utils';
import { findDoc } from './doc-injection';

export class UxDesignerPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'ux-designer';

  protected isReadOnly(): boolean {
    return false;
  }

  protected getExcludedFeedbackTypes(): string[] {
    return ['ux_design_feedback'];
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
          designOverview: {
            type: 'string',
            description: 'Markdown — UX rationale, user flows, accessibility notes',
          },
          options: {
            type: 'array',
            description: 'Design options (2-3), each with metadata and paths to written HTML mock files',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Short identifier, e.g. "option-a"' },
                name: { type: 'string', description: 'Human-readable option name' },
                description: { type: 'string', description: 'Markdown — detailed explanation including rationale, pros, cons, tradeoffs' },
                recommended: { type: 'boolean', description: 'True if this is the recommended option' },
                mocks: {
                  type: 'array',
                  description: 'Mock files written to disk',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: 'Human-readable label, e.g. "Desktop View"' },
                      path: { type: 'string', description: 'Relative path to written HTML file, e.g. "ux-mocks/option-a-desktop.html"' },
                    },
                    required: ['label', 'path'],
                  },
                },
              },
              required: ['id', 'name', 'description', 'recommended', 'mocks'],
            },
          },
          designSpec: {
            type: 'string',
            description: 'Markdown — structured spec for the implementor: component breakdown, interaction spec, responsive behavior, references to existing components to reuse',
          },
          ...getTaskEstimationFields(),
          ...getInteractiveFields(),
        },
        required: ['designOverview', 'options', 'designSpec'],
      },
    };
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode, revisionReason } = context;
    const desc = task.description ? ` ${task.description}` : '';

    let prompt: string;

    if (mode === 'revision' && revisionReason === 'changes_requested') {
      // UX design revision — feedback on existing options
      const lines: string[] = [];
      if (context.sessionId) {
        lines.push(
          `Revise the UX design options based on the feedback below.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
      } else {
        lines.push(
          `The admin has reviewed the current UX design options and requested changes. Revise the design based on their feedback.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
        const planDoc = findDoc(context.docs, 'plan');
        const investigationDoc = findDoc(context.docs, 'investigation_report');
        if (investigationDoc) {
          lines.push('', '## Investigation Report (Summary)', investigationDoc.summary ?? investigationDoc.content);
        }
        if (planDoc) {
          lines.push('', '## Plan', planDoc.content);
        }
      }
      lines.push(...formatFeedbackForPrompt(context.taskContext, ['ux_design_feedback'], 'Admin Feedback on UX Design'));
      lines.push(
        '',
        '## Revision Instructions',
        '- Address every piece of feedback — do not skip or partially address any comment.',
        '- If feedback conflicts with a UX constraint, explain the constraint and propose an alternative.',
        '- Keep options/mocks that were not criticized — only revise what the feedback targets.',
        '- The mock files from the previous run are still on disk in `ux-mocks/`. Edit them in place.',
        '- Do NOT `git add` or commit the mock files — they are ephemeral review artifacts.',
        '- Return updated structured output with all option metadata and file paths.',
        '',
        '## Output Requirements',
        '- The `designOverview` should be a clean, standalone overview — not a changelog.',
        '- The `designSpec` should be a clean, updated spec — not a diff.',
        '- Update mock files in `ux-mocks/` to reflect the feedback.',
      );
      prompt = lines.join('\n');
    } else if (mode === 'revision' && revisionReason === 'info_provided') {
      // UX design resume — continue with user's answers
      const lines: string[] = [];
      if (context.sessionId) {
        lines.push(
          `Continue the UX design using the user's decisions below.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
      } else {
        lines.push(
          `You are a UX designer. Continue the UX design for this task using the user's decisions.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
        const planDoc = findDoc(context.docs, 'plan');
        if (planDoc) {
          lines.push('', '## Plan', planDoc.content);
        }
      }
      lines.push(
        '',
        '## Instructions',
        '1. Review the user\'s answers to your questions in the Task Context above.',
        '2. Use their decisions to guide your UX design.',
        '3. Produce 2-3 design options with HTML/CSS/JS mock files written to `ux-mocks/`.',
        '4. Each mock must be a self-contained HTML file that imports tokens from `.ux-design-kit/tokens.css`.',
        '5. Mark one option as recommended.',
        '6. Do NOT `git add` or commit the mock files — they are ephemeral review artifacts.',
      );
      prompt = lines.join('\n');
    } else {
      // New UX design
      const lines = [
        `You are a UX designer. Produce 2-3 UX design options with interactive HTML/CSS/JS mocks for the following task.`,
        ``,
        `Task: ${task.title}.${desc}`,
      ];
      const investigationDoc = findDoc(context.docs, 'investigation_report');
      const planDoc = findDoc(context.docs, 'plan');
      if (investigationDoc) {
        lines.push('', '## Investigation Report (Summary)', investigationDoc.summary ?? investigationDoc.content);
      }
      if (planDoc) {
        lines.push('', '## Plan', planDoc.content);
      }
      lines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Plan Comments'));
      lines.push(
        '',
        '## Instructions',
        '1. Read the task description and existing plan/investigation report carefully.',
        '2. Read the design reference kit from `.ux-design-kit/` if it exists:',
        '   - `tokens.css` — design tokens (colors, spacing, typography)',
        '   - `patterns.html` — common UI patterns',
        '   - `layout-template.html` — page layout template',
        '   - `screenshots/` — screenshots of existing app UI',
        '   If `.ux-design-kit/` does not exist, proceed with generic design best practices.',
        '3. Explore the existing codebase to understand current UI patterns and components.',
        '4. Produce 2-3 design options. For each option:',
        '   - Give it a clear name and detailed description (rationale, pros, cons, tradeoffs).',
        '   - Write self-contained HTML/CSS/JS mock files to `ux-mocks/` in the worktree.',
        '   - Each mock should import design tokens from `.ux-design-kit/tokens.css` (if available).',
        '   - Mocks should demonstrate layout, interactions, and responsive behavior.',
        '   - Name mock files descriptively: `ux-mocks/<option-id>-<view>.html`',
        '   - Mark one option as recommended.',
        '5. Write a design spec for the implementor covering:',
        '   - Component breakdown',
        '   - Interaction specification',
        '   - Responsive behavior',
        '   - Accessibility considerations',
        '   - References to existing components to reuse',
        '6. Do NOT `git add` or commit the mock files — they are ephemeral review artifacts.',
        '7. Return structured output with option metadata and file paths referencing the written mocks.',
        '',
        '## Mock File Guidelines',
        '- Each HTML file must be self-contained (inline CSS/JS or import from tokens.css only).',
        '- Use semantic HTML elements for accessibility.',
        '- Include responsive breakpoints (mobile, tablet, desktop) where appropriate.',
        '- Add interactive behavior with vanilla JS (hover states, click handlers, transitions).',
        '- Use the design tokens for consistency with the existing app look and feel.',
        '- The `ux-mocks/` directory should be created if it does not already exist.',
      );
      prompt = lines.join('\n');
    }

    prompt += getTaskEstimationInstructions();
    prompt += getInteractiveInstructions(this.type);

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'options_ready';
  }
}
