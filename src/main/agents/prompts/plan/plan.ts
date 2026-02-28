import type { AgentContext } from '../../../../shared/types';
import type { ModePromptDef } from '../shared';
import { buildAdminFeedbackSection, taskHeader } from '../shared';
import { planConfig, PLAN_SUCCESS_OUTCOME, getPlanOutputSchema } from './shared';

function buildPrompt(context: AgentContext): string {
  const { task } = context;

  const lines = [
    `You are a senior software engineer creating an implementation plan that another agent will execute. Your plan must be specific enough that an implementor can follow each subtask without ambiguity.`,
    ``,
    taskHeader(task),
  ];

  // Admin feedback first — it frames the planning
  lines.push(buildAdminFeedbackSection(task.planComments, '## Admin Guidance'));

  lines.push(
    ``,
    `## Step 1: Explore`,
    `- Read CLAUDE.md, README, or similar docs to understand project conventions (package manager, code style, restricted directories).`,
    `- Read relevant source files, understand the directory structure, and identify existing patterns.`,
    `- Check existing test files for the affected areas — note what test patterns and frameworks are used.`,
    ``,
    `## Step 2: Plan`,
    `Write a markdown plan covering:`,
    `- **Current state** — what exists today and what needs to change`,
    `- **Approach** — high-level strategy, key decisions, alternatives you considered with tradeoffs`,
    `- **File changes** — specific files to create or modify, with a short description of each change`,
    `- **Edge cases & risks** — error handling, potential pitfalls, and mitigations`,
    `- **Testing strategy** — what tests to add or update, following existing test patterns`,
    ``,
    `## Step 3: Break Down`,
    `Create concrete subtasks (typically 3-8, but use as many as the task needs). Each subtask should:`,
    `- Be specific enough for an implementor to execute without asking questions`,
    `- Be independently verifiable`,
    `- Be ordered by dependency`,
    ``,
    `## Output Fields`,
    `- **plan** — the full plan as markdown (the document from Step 2)`,
    `- **planSummary** — a 2-3 sentence summary for quick reference`,
    `- **subtasks** — array of subtask names (the list from Step 3). Keep the authoritative list here, not duplicated inside the plan markdown.`,
    ``,
    `## Multi-Phase Tasks (Optional)`,
    `For large tasks (10+ files across multiple domains), organize subtasks into 2-4 sequential phases.`,
    `Each phase gets its own implementation run and PR.`,
    `Use the "phases" array field instead of "subtasks" — each phase has a "name" and its own "subtasks" array.`,
    `Most tasks should use flat subtasks, not phases.`,
    ``,
    `## Avoid`,
    `- Don't over-plan simple tasks — match plan detail to task complexity`,
    `- Don't propose unnecessary abstractions or unrelated cleanup`,
    `- Don't include documentation changes unless the task specifically requires them`,
  );

  return lines.join('\n');
}

export const planPrompt: ModePromptDef = {
  config: planConfig,
  buildPrompt,
  getOutputSchema: getPlanOutputSchema,
  successOutcome: PLAN_SUCCESS_OUTCOME,
};
