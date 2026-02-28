import type { AgentContext } from '../../../../shared/types';
import type { ModePromptDef } from '../shared';
import {
  buildAdminFeedbackSection,
  buildPlanSection,
  buildTechnicalDesignSection,
  buildSubtaskChecklist,
  taskHeader,
} from '../shared';
import { implementConfig, IMPLEMENT_SUCCESS_OUTCOME, getImplementOutputSchema } from './shared';

function buildPrompt(context: AgentContext): string {
  const { task } = context;

  const lines = [
    `You are a software engineer implementing a planned task. Follow the plan and subtasks below precisely — do not deviate from the agreed scope.`,
    ``,
    taskHeader(task),
  ];

  // Plan and design context first — read before working
  lines.push(buildPlanSection(task.plan));
  lines.push(buildAdminFeedbackSection(task.planComments, '## Plan Comments'));
  lines.push(buildTechnicalDesignSection(task.technicalDesign));

  // Subtask checklist — the work items
  lines.push(buildSubtaskChecklist(context));

  lines.push(
    ``,
    `## Instructions`,
    `1. **Read CLAUDE.md and project conventions first** — understand package manager, code style, and restricted directories before writing anything.`,
    `2. **Read the files you will modify.** Understand existing patterns, naming conventions, and code style.`,
    `3. **Implement each subtask in order.** Follow existing patterns, make focused changes — only modify what is necessary.`,
    `4. **Write or update tests** for new code paths, following existing test patterns in the project.`,
    `5. **Run \`yarn checks\`** (or the project's equivalent) to ensure TypeScript and lint pass. Fix any errors.`,
    `6. **Stage and commit** with a descriptive message (git add the relevant files, then git commit).`,
    `7. **Rebase onto origin/main** before finishing: \`git fetch origin && git rebase origin/main\`. Resolve any conflicts, then re-run checks.`,
    ``,
    `## Avoid`,
    `- Don't make changes outside the scope of the plan and subtasks`,
    `- Don't refactor or "improve" code that isn't part of this task`,
    `- Don't skip tests — if the plan includes test subtasks, implement them`,
  );

  return lines.join('\n');
}

export const implementPrompt: ModePromptDef = {
  config: implementConfig,
  buildPrompt,
  getOutputSchema: getImplementOutputSchema,
  successOutcome: IMPLEMENT_SUCCESS_OUTCOME,
};
