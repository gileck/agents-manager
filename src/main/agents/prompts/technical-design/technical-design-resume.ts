import type { AgentContext } from '../../../../shared/types';
import type { ModePromptDef } from '../shared';
import { buildPlanSection, taskHeader } from '../shared';
import { technicalDesignConfig, DESIGN_SUCCESS_OUTCOME, getTechnicalDesignOutputSchema, DESIGN_SECTIONS_INSTRUCTION } from './shared';

function buildPrompt(context: AgentContext): string {
  const { task } = context;

  const lines = [
    `You are a software architect continuing a technical design after receiving the user's answers to your earlier questions. Produce a complete design document that will guide an implementor agent.`,
    ``,
    taskHeader(task),
  ];

  lines.push(buildPlanSection(task.plan));
  if (task.technicalDesign) {
    lines.push('', '## Previous Technical Design', task.technicalDesign);
  }

  lines.push(
    '',
    '## Instructions',
    '1. Review the user\'s answers to your questions in the Task Context above.',
    '2. Use their decisions to guide your design — do not re-ask resolved questions.',
    '3. Produce a complete technical design document covering:',
    DESIGN_SECTIONS_INSTRUCTION,
    '',
    '## Output Fields',
    '- **technicalDesign** — the full design document as markdown',
    '- **designSummary** — a 2-3 sentence summary for quick reference',
  );

  return lines.join('\n');
}

export const technicalDesignResumePrompt: ModePromptDef = {
  config: technicalDesignConfig,
  buildPrompt,
  getOutputSchema: getTechnicalDesignOutputSchema,
  successOutcome: DESIGN_SUCCESS_OUTCOME,
};
