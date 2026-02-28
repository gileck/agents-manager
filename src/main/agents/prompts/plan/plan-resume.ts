import type { AgentContext } from '../../../../shared/types';
import type { ModePromptDef } from '../shared';
import { buildAdminFeedbackSection, taskHeader } from '../shared';
import { planConfig, PLAN_SUCCESS_OUTCOME, getPlanOutputSchema } from './shared';

function buildPrompt(context: AgentContext): string {
  const { task } = context;

  const lines = [
    `You are a senior software engineer continuing an implementation plan after receiving the user's answers to your earlier questions. Produce a complete plan that another agent will execute.`,
    ``,
    taskHeader(task),
  ];

  lines.push(buildAdminFeedbackSection(task.planComments, '## Admin Guidance'));

  lines.push(
    '',
    '## Instructions',
    '1. Review the user\'s answers to your questions in the Task Context above.',
    '2. Use their decisions to guide your plan — do not re-ask resolved questions.',
    '3. **Explore the codebase** to ground your plan in real file paths and existing patterns.',
    '4. Produce a complete plan covering: current state, approach, file changes, edge cases & risks, and testing strategy.',
    '5. Break down into concrete subtasks — each specific enough for an implementor to execute without ambiguity.',
    '',
    '## Output Fields',
    '- **plan** — the full plan as markdown',
    '- **planSummary** — a 2-3 sentence summary for quick reference',
    '- **subtasks** — array of subtask names. Keep the authoritative list here, not duplicated inside the plan markdown.',
  );

  return lines.join('\n');
}

export const planResumePrompt: ModePromptDef = {
  config: planConfig,
  buildPrompt,
  getOutputSchema: getPlanOutputSchema,
  successOutcome: PLAN_SUCCESS_OUTCOME,
};
