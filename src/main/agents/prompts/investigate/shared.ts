import type { ModePromptConfig } from '../shared';
import { getInteractiveFields } from '../shared';

export const investigateConfig: ModePromptConfig = {
  maxTurns: 150,
  timeoutMs: 10 * 60 * 1000,
  interactive: true,
};

export const INVESTIGATE_SUCCESS_OUTCOME = 'investigation_complete';

export function getInvestigateOutputSchema(): object {
  return {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'The detailed investigation report as markdown (root cause analysis, findings, fix suggestion)' },
        investigationSummary: { type: 'string', description: 'A short 2-3 sentence summary of the investigation findings for display in task context' },
        subtasks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concrete fix steps that break down the suggested fix',
        },
        ...getInteractiveFields(),
      },
      required: ['plan', 'investigationSummary', 'subtasks'],
    },
  };
}
