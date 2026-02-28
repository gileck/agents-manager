import type { ModePromptConfig } from '../shared';
import { getInteractiveFields } from '../shared';

export const planConfig: ModePromptConfig = {
  maxTurns: 150,
  timeoutMs: 10 * 60 * 1000,
  interactive: true,
};

export const PLAN_SUCCESS_OUTCOME = 'plan_complete';

export function getPlanOutputSchema(): object {
  return {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'The full implementation plan as markdown' },
        planSummary: { type: 'string', description: 'A short 2-3 sentence summary of the plan for display in task context' },
        subtasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concrete implementation steps that break down the plan. Use this for single-phase tasks (most tasks).',
        },
        phases: {
          type: 'array',
          description: 'Optional: For large tasks that should be implemented in multiple sequential phases, each with its own PR. Only use when the task is genuinely large enough to warrant separate PRs. Most tasks should use flat subtasks instead.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Phase name, e.g. "Phase 1: Data Model & Migration"' },
              subtasks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Subtasks belonging to this phase',
              },
            },
            required: ['name', 'subtasks'],
          },
        },
        ...getInteractiveFields(),
      },
      required: ['plan', 'planSummary', 'subtasks'],
    },
  };
}
