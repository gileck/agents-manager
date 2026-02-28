import type { AgentContext } from '../../../../shared/types';
import type { ModePromptDef } from '../shared';
import { buildAdminFeedbackSection, taskHeader } from '../shared';
import { planConfig, PLAN_SUCCESS_OUTCOME, getPlanOutputSchema } from './shared';

function buildPrompt(context: AgentContext): string {
  const { task } = context;

  const lines = [
    `You are a senior software engineer revising an implementation plan based on admin feedback. Produce an updated plan that another agent will execute.`,
    ``,
    taskHeader(task),
  ];

  if (task.plan) {
    lines.push('', '## Current Plan', task.plan);
  }

  lines.push(buildAdminFeedbackSection(task.planComments));

  lines.push(
    '',
    '## Revision Guidelines',
    '- Address every piece of feedback — do not skip or partially address any comment.',
    '- If feedback is ambiguous, interpret it in the most reasonable way and note your interpretation.',
    '- Keep parts of the plan that were not criticized — only revise what the feedback targets.',
    '- If feedback changes scope (e.g. "also handle X"), explore the relevant code before revising.',
    '',
    '## Output Fields',
    '- **plan** — the full revised plan as markdown',
    '- **planSummary** — a 2-3 sentence summary for quick reference',
    '- **subtasks** — updated array of subtask names reflecting the revised plan',
  );

  return lines.join('\n');
}

export const planRevisionPrompt: ModePromptDef = {
  config: planConfig,
  buildPrompt,
  getOutputSchema: getPlanOutputSchema,
  successOutcome: PLAN_SUCCESS_OUTCOME,
};
