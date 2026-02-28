import type { AgentContext } from '../../../../shared/types';
import type { ModePromptDef } from '../shared';
import {
  buildPlanSection,
  buildTechnicalDesignSection,
  buildSubtaskChecklist,
  taskHeader,
} from '../shared';
import { implementConfig, IMPLEMENT_SUCCESS_OUTCOME, getImplementOutputSchema } from './shared';

function buildPrompt(context: AgentContext): string {
  const { task } = context;

  const lines = [
    `You are a software engineer continuing implementation after receiving the user's answers to your earlier questions. Follow the plan and subtasks — do not deviate from the agreed scope.`,
    ``,
    taskHeader(task),
  ];

  // Plan and design context first
  lines.push(buildPlanSection(task.plan));
  lines.push(buildTechnicalDesignSection(task.technicalDesign));

  // Subtask checklist
  lines.push(buildSubtaskChecklist(context));

  lines.push(
    '',
    '## Instructions',
    '1. Review the user\'s answers to your questions in the Task Context above.',
    '2. Use their decisions to guide your implementation — do not re-ask resolved questions.',
    '3. Follow existing patterns, make focused changes only.',
    '4. Write or update tests for new code paths.',
    '5. Run `yarn checks` (or the project\'s equivalent) to ensure TypeScript and lint pass.',
    '6. Stage and commit with a descriptive message.',
    '7. **Rebase onto origin/main** before finishing: `git fetch origin && git rebase origin/main`. Resolve any conflicts, then re-run checks.',
  );

  return lines.join('\n');
}

export const implementResumePrompt: ModePromptDef = {
  config: implementConfig,
  buildPrompt,
  getOutputSchema: getImplementOutputSchema,
  successOutcome: IMPLEMENT_SUCCESS_OUTCOME,
};
