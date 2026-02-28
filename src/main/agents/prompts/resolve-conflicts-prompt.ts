import type { AgentContext } from '../../../shared/types';
import { type ModePromptDef, taskHeader } from './shared';

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

function getResolveConflictsOutputSchema(): object {
  return {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'A short summary of how merge conflicts were resolved' },
      },
      required: ['summary'],
    },
  };
}

// ---------------------------------------------------------------------------
// resolve_conflicts
// ---------------------------------------------------------------------------

function buildResolveConflictsPrompt(context: AgentContext): string {
  const { task } = context;

  const lines = [
    `You are a software engineer resolving merge conflicts. The branch for this task has conflicts with origin/main. Resolve them so the branch can be pushed cleanly.`,
    ``,
    taskHeader(task),
    ``,
    `## Instructions`,
    `1. Run \`git fetch origin\` to get the latest main.`,
    `2. Read the conflicting files and understand both sides before rebasing — know what main changed and what this branch changed.`,
    `3. Run \`git rebase origin/main\` to start the rebase.`,
    `4. For each conflict, resolve by preserving the intent of both changes, then \`git add\` the resolved files.`,
    `5. Run \`git rebase --continue\` after resolving each conflict.`,
    `6. Once the rebase is complete, run \`yarn checks\` (or the project's equivalent) to ensure TypeScript and lint pass.`,
    `7. Do NOT push — the pipeline will handle pushing after you finish.`,
  ];

  return lines.join('\n');
}

export const resolveConflictsPrompt: ModePromptDef = {
  config: { maxTurns: 50, timeoutMs: 10 * 60 * 1000, interactive: false },
  buildPrompt: buildResolveConflictsPrompt,
  getOutputSchema: getResolveConflictsOutputSchema,
  successOutcome: 'pr_ready',
};
