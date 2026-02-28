import type { ModePromptConfig } from '../shared';
import { getInteractiveFields } from '../shared';

export const technicalDesignConfig: ModePromptConfig = {
  maxTurns: 150,
  timeoutMs: 10 * 60 * 1000,
  interactive: true,
};

export const DESIGN_SUCCESS_OUTCOME = 'design_ready';

export function getTechnicalDesignOutputSchema(): object {
  return {
    type: 'json_schema',
    schema: {
      type: 'object',
      properties: {
        technicalDesign: { type: 'string', description: 'The full technical design document as markdown' },
        designSummary: { type: 'string', description: 'A short 2-3 sentence summary of the technical design' },
        ...getInteractiveFields(),
      },
      required: ['technicalDesign', 'designSummary'],
    },
  };
}

/** Shared design document sections instruction used by design and design_resume. */
export const DESIGN_SECTIONS_INSTRUCTION = [
  '   - **Architecture Overview** — high-level approach',
  '   - **Files to Create/Modify** — specific file paths with descriptions',
  '   - **Data Model Changes** — schema/type changes if needed',
  '   - **API/Interface Changes** — new or modified interfaces',
  '   - **Key Implementation Details** — algorithms, patterns, edge cases',
  '   - **Migration Strategy** — how to roll out the change safely (if applicable)',
  '   - **Performance Considerations** — scalability, latency, resource usage',
  '   - **Dependencies** — new packages, existing utilities to reuse',
  '   - **Testing Strategy** — what to test and how',
  '   - **Risk Assessment** — potential issues and mitigations',
].join('\n');
