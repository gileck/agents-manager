import type { AgentContext } from '../../../../shared/types';
import type { ModePromptDef } from '../shared';
import { buildAdminFeedbackSection, buildPlanSection, taskHeader } from '../shared';
import { technicalDesignConfig, DESIGN_SUCCESS_OUTCOME, getTechnicalDesignOutputSchema } from './shared';

function buildPrompt(context: AgentContext): string {
  const { task } = context;

  const lines = [
    `You are a software architect revising a technical design based on admin feedback. Produce an updated design document.`,
    ``,
    taskHeader(task),
  ];

  lines.push(buildPlanSection(task.plan));
  if (task.technicalDesign) {
    lines.push('', '## Current Technical Design', task.technicalDesign);
  }

  lines.push(buildAdminFeedbackSection(task.technicalDesignComments, '## Admin Feedback on Design'));

  lines.push(
    '',
    '## Revision Guidelines',
    '- Address every piece of feedback — do not skip or partially address any comment.',
    '- If feedback conflicts with a technical constraint, explain the constraint and propose an alternative that satisfies the intent.',
    '- Keep parts of the design that were not criticized — only revise what the feedback targets.',
    '- If feedback changes scope, explore the relevant code before revising.',
    '',
    '## Output Fields',
    '- **technicalDesign** — the full revised design document as markdown',
    '- **designSummary** — a 2-3 sentence summary for quick reference',
  );

  return lines.join('\n');
}

export const technicalDesignRevisionPrompt: ModePromptDef = {
  config: technicalDesignConfig,
  buildPrompt,
  getOutputSchema: getTechnicalDesignOutputSchema,
  successOutcome: DESIGN_SUCCESS_OUTCOME,
};
