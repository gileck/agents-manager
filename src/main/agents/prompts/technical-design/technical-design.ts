import type { AgentContext } from '../../../../shared/types';
import type { ModePromptDef } from '../shared';
import { buildAdminFeedbackSection, buildPlanSection, taskHeader } from '../shared';
import { technicalDesignConfig, DESIGN_SUCCESS_OUTCOME, getTechnicalDesignOutputSchema, DESIGN_SECTIONS_INSTRUCTION } from './shared';

function buildPrompt(context: AgentContext): string {
  const { task } = context;

  const lines = [
    `You are a software architect producing a technical design document. This document will guide an implementor agent, so it must be specific about file paths, interfaces, and data flows.`,
    ``,
    taskHeader(task),
  ];

  lines.push(buildPlanSection(task.plan));
  lines.push(buildAdminFeedbackSection(task.planComments, '## Plan Comments'));

  lines.push(
    '',
    '## Instructions',
    '1. Read CLAUDE.md and project conventions to understand architecture constraints.',
    '2. Read the task description and the existing plan carefully.',
    '3. Explore the codebase thoroughly — file structure, patterns, existing implementations.',
    '4. Produce a structured technical design document covering:',
    DESIGN_SECTIONS_INSTRUCTION,
    '',
    '## Output Fields',
    '- **technicalDesign** — the full design document as markdown',
    '- **designSummary** — a 2-3 sentence summary for quick reference',
  );

  return lines.join('\n');
}

export const technicalDesignPrompt: ModePromptDef = {
  config: technicalDesignConfig,
  buildPrompt,
  getOutputSchema: getTechnicalDesignOutputSchema,
  successOutcome: DESIGN_SUCCESS_OUTCOME,
};
