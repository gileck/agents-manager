import type { AgentContext } from '../../../shared/types';
import { getActivePhase, getActivePhaseIndex, isMultiPhase } from '../../../shared/phase-utils';

// ---------------------------------------------------------------------------
// Mode prompt config — each prompt file exports one per mode
// ---------------------------------------------------------------------------

export interface ModePromptConfig {
  maxTurns: number;
  timeoutMs: number;
  interactive: boolean;
}

export interface ModePromptDef {
  config: ModePromptConfig;
  buildPrompt: (context: AgentContext) => string;
  getOutputSchema: () => object | undefined;
  /** The outcome string returned when the agent exits successfully (exit code 0). */
  successOutcome: string;
}

// ---------------------------------------------------------------------------
// Interactive questions — JSON schema fields + prompt instructions
// ---------------------------------------------------------------------------

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

export function getInteractiveInstructions(mode: string): string {
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
  if (mode === 'technical_design' || mode === 'technical_design_revision') {
    base.push(
      '',
      'For technical design, it is often valuable to propose multiple solution approaches.',
      'When there are genuinely different viable approaches, present them as options with',
      'clear descriptions including tradeoffs, pros/cons, and mark one as recommended.',
    );
  }
  return base.join('\n');
}

// ---------------------------------------------------------------------------
// Common section builders
// ---------------------------------------------------------------------------

export function buildAdminFeedbackSection(
  comments: Array<{ author: string; content: string; createdAt: number }> | undefined | null,
  heading = '## Admin Feedback',
): string {
  if (!comments || comments.length === 0) return '';
  const lines = ['', heading];
  for (const comment of comments) {
    const time = new Date(comment.createdAt).toLocaleString();
    lines.push(`- **${comment.author}** (${time}): ${comment.content}`);
  }
  return lines.join('\n');
}

export function buildPlanSection(plan: string | null | undefined): string {
  if (!plan) return '';
  return ['', '## Plan', plan].join('\n');
}

export function buildTechnicalDesignSection(technicalDesign: string | null | undefined): string {
  if (!technicalDesign) return '';
  return ['', '## Technical Design', technicalDesign].join('\n');
}

export function buildSubtaskChecklist(context: AgentContext): string {
  const { task } = context;
  const activePhase = getActivePhase(task.phases);

  if (isMultiPhase(task) && activePhase) {
    const phaseIdx = getActivePhaseIndex(task.phases);
    const totalPhases = task.phases?.length ?? 0;
    const lines = [
      '',
      `## Current Phase: ${activePhase.name} (${phaseIdx + 1}/${totalPhases})`,
      'You are implementing ONLY this phase. Focus on the subtasks listed below.',
    ];
    const completedPhases = (task.phases ?? []).filter(p => p.status === 'completed');
    if (completedPhases.length > 0) {
      lines.push('', '### Previously Completed Phases');
      for (const cp of completedPhases) {
        lines.push(`- ${cp.name} (completed${cp.prLink ? `, PR: ${cp.prLink}` : ''})`);
      }
    }
    lines.push(
      '',
      '## IMPORTANT: Subtask Progress Tracking',
      'Create a todo list with the following subtasks and update their status as you work through them:',
      '',
    );
    for (const st of activePhase.subtasks) {
      lines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
    }
    lines.push('');
    return lines.join('\n');
  }

  if (task.subtasks && task.subtasks.length > 0) {
    const lines = [
      '',
      '## IMPORTANT: Subtask Progress Tracking',
      'Create a todo list with the following subtasks and update their status as you work through them:',
      '',
    ];
    for (const st of task.subtasks) {
      lines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
    }
    lines.push('');
    return lines.join('\n');
  }

  return '';
}

export function buildSimpleSubtaskList(subtasks: Array<{ name: string; status: string }> | undefined | null): string {
  if (!subtasks || subtasks.length === 0) return '';
  const lines = ['', '## Subtasks'];
  for (const st of subtasks) {
    lines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
  }
  return lines.join('\n');
}

export function taskHeader(task: { title: string; description?: string | null }): string {
  const desc = task.description ? ` ${task.description}` : '';
  return `Task: ${task.title}.${desc}`;
}
