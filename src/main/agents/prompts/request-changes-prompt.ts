import type { AgentContext } from '../../../shared/types';
import {
  type ModePromptDef,
  buildAdminFeedbackSection,
  buildPlanSection,
  buildTechnicalDesignSection,
  taskHeader,
} from './shared';

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

function getRequestChangesOutputSchema(): object {
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
}

// ---------------------------------------------------------------------------
// request_changes
// ---------------------------------------------------------------------------

function buildRequestChangesPrompt(context: AgentContext): string {
  const { task } = context;

  const lines = [
    `You are a software engineer addressing code review feedback. Fix ONLY the issues raised by the reviewer — nothing more, nothing less.`,
    ``,
    taskHeader(task),
  ];

  lines.push(buildPlanSection(task.plan));
  lines.push(buildAdminFeedbackSection(task.planComments, '## Plan Comments'));
  lines.push(buildTechnicalDesignSection(task.technicalDesign));

  lines.push(
    ``,
    `## Instructions`,
    `1. Read the reviewer's feedback in the Task Context above carefully.`,
    `2. Fix every issue mentioned — do not skip or ignore any feedback.`,
    `3. **Do not make unrelated changes** — only fix what the reviewer asked for. No refactoring, no "while I'm here" improvements.`,
    `4. Run \`yarn checks\` (or the project's equivalent) to ensure TypeScript and lint pass.`,
    `5. Stage and commit with a descriptive message referencing which reviewer feedback was addressed.`,
    `6. **Rebase onto origin/main** before finishing: \`git fetch origin && git rebase origin/main\`. Resolve any conflicts, then re-run checks.`,
  );

  return lines.join('\n');
}

export const requestChangesPrompt: ModePromptDef = {
  config: { maxTurns: 200, timeoutMs: 30 * 60 * 1000, interactive: false },
  buildPrompt: buildRequestChangesPrompt,
  getOutputSchema: getRequestChangesOutputSchema,
  successOutcome: 'pr_ready',
};
