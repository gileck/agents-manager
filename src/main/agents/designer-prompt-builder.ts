import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { formatCommentsForPrompt, getInteractiveFields, getInteractiveInstructions } from './prompt-utils';

export class DesignerPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'designer';

  protected isReadOnly(): boolean {
    return false;
  }

  protected getMaxTurns(): number {
    return 150;
  }

  protected getTimeout(_context: AgentContext, config: AgentConfig): number {
    return config.timeout || 10 * 60 * 1000;
  }

  protected getOutputFormat(): object {
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

  buildPrompt(context: AgentContext): string {
    const { task, mode, revisionReason } = context;
    const desc = task.description ? ` ${task.description}` : '';

    let prompt: string;

    if (mode === 'revision' && revisionReason === 'changes_requested') {
      // Technical design revision (was: technical_design_revision)
      const tdrLines = [
        `The admin has reviewed the current technical design and requested changes. Revise the design based on their feedback.`,
        ``,
        `Task: ${task.title}.${desc}`,
      ];
      if (task.plan) {
        tdrLines.push('', '## Plan', task.plan);
      }
      if (task.technicalDesign) {
        tdrLines.push('', '## Current Technical Design', task.technicalDesign);
      }
      tdrLines.push(...formatCommentsForPrompt(task.technicalDesignComments, 'Admin Feedback on Design'));
      tdrLines.push(
        '',
        '## Revision Guidelines',
        '- Address every piece of feedback — do not skip or partially address any comment.',
        '- If feedback conflicts with a technical constraint, explain the constraint and propose an alternative that satisfies the intent.',
        '- Keep parts of the design that were not criticized — only revise what the feedback targets.',
        '- Produce an updated design document.',
        '- In the `designSummary` field, describe what you changed and how you addressed the admin\'s feedback.',
      );
      prompt = tdrLines.join('\n');
    } else if (mode === 'revision' && revisionReason === 'info_provided') {
      // Technical design resume (was: technical_design_resume)
      const tdrLines = [
        `You are a software architect. Continue the technical design for this task using the user's decisions.`,
        ``,
        `Task: ${task.title}.${desc}`,
      ];
      if (task.plan) {
        tdrLines.push('', '## Plan', task.plan);
      }
      if (task.technicalDesign) {
        tdrLines.push('', '## Previous Technical Design', task.technicalDesign);
      }
      tdrLines.push(
        '',
        '## Instructions',
        '1. Review the user\'s answers to your questions in the Task Context above.',
        '2. Use their decisions to guide your technical design.',
        '3. Produce a complete technical design document covering:',
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
      );
      prompt = tdrLines.join('\n');
    } else {
      // New technical design (was: technical_design)
      const tdLines = [
        `You are a software architect. Produce a detailed technical design document for the following task.`,
        ``,
        `Task: ${task.title}.${desc}`,
      ];
      if (task.plan) {
        tdLines.push('', '## Plan', task.plan);
      }
      tdLines.push(...formatCommentsForPrompt(task.planComments, 'Plan Comments'));
      tdLines.push(
        '',
        '## Instructions',
        '1. Read the task description and the existing plan carefully.',
        '2. Explore the codebase thoroughly — file structure, patterns, existing implementations.',
        '3. Produce a structured technical design document covering:',
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
      );
      prompt = tdLines.join('\n');
    }

    prompt += getInteractiveInstructions(this.type);

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'design_ready';
  }
}
