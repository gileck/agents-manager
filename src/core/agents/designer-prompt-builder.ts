import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { formatFeedbackForPrompt, getInteractiveFields, getInteractiveInstructions, getTaskEstimationFields, getTaskEstimationInstructions } from './prompt-utils';
import { findDoc } from './doc-injection';

export class DesignerPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'designer';

  protected isReadOnly(): boolean {
    return false;
  }

  protected getExcludedFeedbackTypes(): string[] {
    return ['design_feedback'];
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
          ...getTaskEstimationFields(),
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
      const tdrLines: string[] = [];
      if (context.sessionId) {
        tdrLines.push(
          `Revise the design based on the feedback below.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
      } else {
        tdrLines.push(
          `The admin has reviewed the current technical design and requested changes. Revise the design based on their feedback.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
        const planDoc = findDoc(context.docs, 'plan');
        const designDoc = findDoc(context.docs, 'technical_design');
        if (planDoc) {
          tdrLines.push('', '## Plan', planDoc.content);
        }
        if (designDoc) {
          tdrLines.push('', '## Current Technical Design', designDoc.content);
        }
      }
      tdrLines.push(...formatFeedbackForPrompt(context.taskContext, ['design_feedback'], 'Admin Feedback on Design'));
      tdrLines.push(
        '',
        '## Revision Guidelines',
        '- Address every piece of feedback — do not skip or partially address any comment.',
        '- If feedback conflicts with a technical constraint, explain the constraint and propose an alternative that satisfies the intent.',
        '- Keep parts of the design that were not criticized — only revise what the feedback targets.',
        '',
        '## Output Requirements',
        '- The `technicalDesign` field must be a CLEAN, standalone design document — as if written from scratch.',
        '  - Do NOT include "(Revised)" in the title.',
        '  - Do NOT include "Changes from Initial Design", "Addressing Feedback", or any revision commentary.',
        '  - Do NOT include sections explaining what changed or how feedback was addressed.',
        '  - The design should read as a fresh, authoritative document — not as a diff or changelog.',
        '- The `designSummary` field is where you describe what changed and how you addressed the feedback.',
        '  - This is the ONLY place revision notes belong.',
      );
      prompt = tdrLines.join('\n');
    } else if (mode === 'revision' && revisionReason === 'info_provided') {
      // Technical design resume (was: technical_design_resume)
      const tdrLines: string[] = [];
      if (context.sessionId) {
        tdrLines.push(
          `Continue the technical design using the user's decisions below.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
      } else {
        tdrLines.push(
          `You are a software architect. Continue the technical design for this task using the user's decisions.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
        const irPlanDoc = findDoc(context.docs, 'plan');
        const irDesignDoc = findDoc(context.docs, 'technical_design');
        if (irPlanDoc) {
          tdrLines.push('', '## Plan', irPlanDoc.content);
        }
        if (irDesignDoc) {
          tdrLines.push('', '## Previous Technical Design', irDesignDoc.content);
        }
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
      const newPlanDoc = findDoc(context.docs, 'plan');
      if (newPlanDoc) {
        tdLines.push('', '## Plan', newPlanDoc.content);
      }
      tdLines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Plan Comments'));
      tdLines.push(
        '',
        '## Instructions',
        '1. Read the task description and the existing plan carefully.',
        '2. Explore the codebase thoroughly — file structure, patterns, existing implementations. If you delegate to an Explore subagent, wait for its result before issuing any further search or read calls — do not search in parallel with a running subagent.',
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

    prompt += getTaskEstimationInstructions();
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
