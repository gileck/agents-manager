import type { AgentContext } from '../../../../shared/types';
import type { ModePromptDef } from '../shared';
import { buildSimpleSubtaskList } from '../shared';
import { investigateConfig, INVESTIGATE_SUCCESS_OUTCOME, getInvestigateOutputSchema } from './shared';

function buildPrompt(context: AgentContext): string {
  const { task } = context;
  const desc = task.description ? ` ${task.description}` : '';
  const amCli = `npx agents-manager`;

  const lines = [
    `You are a bug investigator. Analyze the following bug report, find the root cause, and propose a concrete fix plan.`,
    ``,
    `Bug: ${task.title}.${desc}`,
  ];

  const relatedTaskId = task.metadata?.relatedTaskId as string | undefined;
  if (relatedTaskId) {
    lines.push(
      ``,
      `## Related Task`,
      `This bug references task \`${relatedTaskId}\`. Use the CLI to inspect it:`,
      `  ${amCli} tasks get ${relatedTaskId} --json`,
      `  ${amCli} events list --task ${relatedTaskId} --json`,
    );
  }

  lines.push(buildSimpleSubtaskList(task.subtasks));

  lines.push(
    ``,
    `## Step 1: Gather Context`,
    `- Read the bug report carefully — it may contain debug logs, error traces, and timeline entries.`,
    `- Use the CLI for additional info: \`${amCli} tasks get ${task.id} --json\` and \`${amCli} events list --task ${task.id} --json\``,
    ``,
    `## Step 2: Investigate`,
    `- For targeted lookups (function names, error strings), use Read, Grep, and Glob directly.`,
    `- Only spawn Task/Explore sub-agents for broad discovery across unknown directories. Don't duplicate searches.`,
    `- Try to reproduce the issue — run relevant commands or tests to confirm the bug.`,
    `- Trace the execution path to find the root cause.`,
    ``,
    `## Step 3: Report`,
    `Write an investigation report (the "plan" output field) covering:`,
    `- **Symptoms** — what was observed, including error messages and logs`,
    `- **Root cause** — the specific code/logic that causes the bug and why`,
    `- **Reproduction** — how to reproduce (commands, test cases)`,
    `- **Existing test coverage** — what tests exist for the affected code and what gaps there are`,
    `- **Proposed fix** — what to change and why, including tests to add or update`,
    ``,
    `## Output Fields`,
    `- **plan** — the investigation report as markdown (the document from Step 3)`,
    `- **investigationSummary** — a 2-3 sentence summary for quick reference`,
    `- **subtasks** — concrete fix steps, each specific enough for an implementor to execute`,
  );

  return lines.join('\n');
}

export const investigatePrompt: ModePromptDef = {
  config: investigateConfig,
  buildPrompt,
  getOutputSchema: getInvestigateOutputSchema,
  successOutcome: INVESTIGATE_SUCCESS_OUTCOME,
};
