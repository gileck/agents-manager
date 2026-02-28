import type { ModePromptConfig } from '../shared';
import { getInteractiveFields } from '../shared';

export const implementConfig: ModePromptConfig = {
  maxTurns: 200,
  timeoutMs: 30 * 60 * 1000,
  interactive: true,
};

export const IMPLEMENT_SUCCESS_OUTCOME = 'pr_ready';

export function getImplementOutputSchema(): object {
  return {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'A short summary of the changes implemented' },
        ...getInteractiveFields(),
      },
      required: ['summary'],
    },
  };
}
