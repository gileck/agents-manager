import type { AgentContext } from '../../../../shared/types';
import type { ModePromptDef } from '../shared';
import { buildSimpleSubtaskList } from '../shared';
import { investigateConfig, INVESTIGATE_SUCCESS_OUTCOME, getInvestigateOutputSchema } from './shared';

function buildPrompt(context: AgentContext): string {
  const { task } = context;
  const desc = task.description ? ` ${task.description}` : '';

  const lines = [
    `You are a bug investigator continuing your investigation after receiving the user's answers to your earlier questions.`,
    ``,
    `Bug: ${task.title}.${desc}`,
  ];

  lines.push(buildSimpleSubtaskList(task.subtasks));

  lines.push(
    '',
    '## Instructions',
    '1. Review the user\'s answers to your questions in the Task Context above.',
    '2. Use their decisions to guide your investigation — do not re-ask resolved questions.',
    '3. For targeted lookups, use Read, Grep, and Glob directly. Only spawn Task/Explore sub-agents for broad discovery. Don\'t duplicate searches.',
    '4. Produce a complete investigation report covering: symptoms, root cause, reproduction steps, existing test coverage, and proposed fix.',
    '',
    '## Output Fields',
    '- **plan** — the investigation report as markdown',
    '- **investigationSummary** — a 2-3 sentence summary for quick reference',
    '- **subtasks** — concrete fix steps, each specific enough for an implementor to execute',
  );

  return lines.join('\n');
}

export const investigateResumePrompt: ModePromptDef = {
  config: investigateConfig,
  buildPrompt,
  getOutputSchema: getInvestigateOutputSchema,
  successOutcome: INVESTIGATE_SUCCESS_OUTCOME,
};
