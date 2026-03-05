import { VALID_TASK_SIZES, VALID_TASK_COMPLEXITIES } from '../../shared/types';
import type { PlanComment, TaskContextEntry } from '../../shared/types';

/**
 * @deprecated Use formatFeedbackForPrompt instead, which works with TaskContextEntry.
 */
export function formatCommentsForPrompt(
  comments: PlanComment[],
  sectionTitle: string,
): string[] {
  if (!comments || comments.length === 0) return [];

  const newComments = comments.filter(c => !c.addressed);
  const addressedCount = comments.length - newComments.length;

  const lines: string[] = [];

  if (newComments.length > 0) {
    lines.push('', `## ${sectionTitle}`);
    for (const comment of newComments) {
      const time = new Date(comment.createdAt).toLocaleString();
      lines.push(`- **${comment.author}** (${time}): ${comment.content}`);
    }
  }

  if (addressedCount > 0) {
    if (newComments.length === 0) {
      lines.push('');
    }
    lines.push(`Note: ${addressedCount} previous feedback comment${addressedCount > 1 ? 's were' : ' was'} already addressed in the current plan.`);
  }

  return lines;
}

/**
 * Format context entries of specific feedback types for inclusion in agent prompts.
 * Splits entries into actionable (unaddressed) and already-addressed groups.
 * Only unaddressed entries are shown as actionable feedback; addressed entries
 * get a one-line summary count.
 */
export function formatFeedbackForPrompt(
  entries: TaskContextEntry[] | undefined,
  feedbackTypes: string[],
  sectionTitle: string,
): string[] {
  if (!entries || entries.length === 0) return [];

  const matching = entries.filter(e => feedbackTypes.includes(e.entryType));
  if (matching.length === 0) return [];

  const unaddressed = matching.filter(e => !e.addressed);
  const addressedCount = matching.length - unaddressed.length;

  const lines: string[] = [];

  if (unaddressed.length > 0) {
    lines.push('', `## ${sectionTitle}`);
    for (const entry of unaddressed) {
      const time = new Date(entry.createdAt).toLocaleString();
      lines.push(`- **${entry.source}** (${time}): ${entry.summary}`);
    }
  }

  if (addressedCount > 0) {
    if (unaddressed.length === 0) {
      lines.push('');
    }
    lines.push(`Note: ${addressedCount} previous feedback comment${addressedCount > 1 ? 's were' : ' was'} already addressed.`);
  }

  return lines;
}

/**
 * Format context entries as read-only informational context (not actionable feedback).
 * Only shows unaddressed entries — resolved Q&A (addressed entries) are omitted to save tokens.
 * If all entries are addressed, the section is skipped entirely.
 */
export function formatFeedbackAsContext(
  entries: TaskContextEntry[] | undefined,
  feedbackTypes: string[],
  sectionTitle: string,
): string[] {
  if (!entries || entries.length === 0) return [];

  const unaddressed = entries.filter(e => feedbackTypes.includes(e.entryType) && !e.addressed);
  if (unaddressed.length === 0) return [];

  const lines: string[] = ['', `## ${sectionTitle} (Context Only)`];
  lines.push('*These comments are from a prior review phase — provided for reference only.*');
  for (const entry of unaddressed) {
    const time = new Date(entry.createdAt).toLocaleString();
    lines.push(`- **${entry.source}** (${time}): ${entry.summary}`);
  }
  return lines;
}

/** Shared schema fields that let any agent ask interactive questions. */
export function getInteractiveFields(): Record<string, object> {
  return {
    outcome: {
      type: 'string',
      enum: ['needs_info'],
      description: 'Set to "needs_info" ONLY if you need user input before proceeding. Leave unset when work is complete.',
    },
    questions: {
      type: 'array',
      description: 'Questions for the user (only when outcome="needs_info"). Max 5.',
      items: {
        type: 'object',
        properties: {
          id:       { type: 'string', description: 'Unique question identifier (e.g. "q1")' },
          question: { type: 'string', description: 'The question text' },
          context:  { type: 'string', description: 'Why you need this answered' },
          options:  {
            type: 'array',
            description: 'Options to choose from (omit for free-text questions)',
            items: {
              type: 'object',
              properties: {
                id:          { type: 'string' },
                label:       { type: 'string' },
                description: { type: 'string' },
                recommended: { type: 'boolean' },
              },
              required: ['id', 'label', 'description'],
            },
          },
        },
        required: ['id', 'question'],
      },
    },
  };
}

/** Shared schema fields for task size and complexity estimation. */
export function getTaskEstimationFields(): Record<string, object> {
  return {
    size: {
      type: 'string',
      enum: [...VALID_TASK_SIZES],
      description: 'Estimated task size (effort): xs=trivial, sm=small, md=medium, lg=large, xl=extra-large',
    },
    complexity: {
      type: 'string',
      enum: [...VALID_TASK_COMPLEXITIES],
      description: 'Estimated task complexity: low=straightforward, medium=some nuance, high=many moving parts or unknowns',
    },
  };
}

/** Prompt section instructing agents to estimate task size and complexity. */
export function getTaskEstimationInstructions(): string {
  return [
    '',
    '## Task Estimation',
    'If you can assess the size and complexity of this task based on your analysis, include them in your output:',
    '- **size**: xs (trivial, <1 file), sm (small, 1-2 files), md (medium, 3-5 files), lg (large, 6-10 files), xl (extra-large, 10+ files)',
    '- **complexity**: low (straightforward, clear path), medium (some decisions or cross-cutting concerns), high (many unknowns, architectural impact)',
    'These are optional — only set them if you have enough information to make a reasonable estimate.',
  ].join('\n');
}

/** Prompt section telling agents they can ask interactive questions. */
export function getInteractiveInstructions(agentType: string): string {
  const base = [
    '',
    '## Interactive Questions',
    'If you encounter ambiguity or need user input before proceeding, you can ask questions:',
    '- Set `outcome` to `"needs_info"` in your output',
    '- Provide a `questions` array with your questions (max 5)',
    '- Each question has: `id`, `question`, optional `context`, optional `options[]`',
    '- For multiple-choice: include `options` with `id`, `label`, `description`, and optionally `recommended: true`',
    '- The user can also add custom text to any answer',
    '- Only ask when genuinely needed — do not ask if you can make a reasonable decision yourself',
  ];
  if (agentType === 'designer') {
    base.push(
      '',
      'For technical design, it is often valuable to propose multiple solution approaches.',
      'When there are genuinely different viable approaches, present them as options with',
      'clear descriptions including tradeoffs, pros/cons, and mark one as recommended.',
    );
  }
  return base.join('\n');
}
