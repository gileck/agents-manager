import { VALID_TASK_SIZES, VALID_TASK_COMPLEXITIES } from '../../shared/types';
import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';

export class PostMortemReviewerPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'post-mortem-reviewer';

  protected getMaxTurns(_context: AgentContext): number {
    return 50;
  }

  protected getTimeout(_context: AgentContext, config: AgentConfig): number {
    return config.timeout || 5 * 60 * 1000;
  }

  protected isReadOnly(_context: AgentContext): boolean {
    return true;
  }

  protected getOutputFormat(_context: AgentContext): object | undefined {
    return {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          rootCause: {
            type: 'string',
            enum: ['missed_edge_case', 'design_flaw', 'incomplete_requirements', 'inadequate_review', 'missing_tests', 'other'],
            description: 'Primary root cause classification for the defect',
          },
          severity: {
            type: 'string',
            enum: ['minor', 'moderate', 'major'],
            description: 'Severity of the defect',
          },
          responsibleAgents: {
            type: 'array',
            items: { type: 'string' },
            description: 'Which agents (planner, designer, implementor, reviewer) should have caught this issue',
          },
          analysis: {
            type: 'string',
            description: 'Detailed analysis of what went wrong and why, referencing specific parts of the plan, design, implementation, or review',
          },
          promptImprovements: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific changes to agent prompt templates that would have prevented this defect',
          },
          processImprovements: {
            type: 'array',
            items: { type: 'string' },
            description: 'Changes to the workflow process, review gates, or validation steps that would prevent similar defects',
          },
          suggestedTasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Actionable task title (imperative form)' },
                type: { type: 'string', enum: ['bug', 'feature', 'improvement'], description: 'Task type' },
                description: { type: 'string', description: 'Markdown-formatted description covering: **Where**, **Problem**, **Fix**, **Complexity**, **ROI**' },
                debugInfo: { type: 'string', description: 'Raw debug data relevant to bug tasks. Omit if not applicable.' },
                priority: { type: 'number', enum: [0, 1, 2, 3], description: 'Priority: 0=Critical, 1=High, 2=Medium, 3=Low' },
                size: { type: 'string', enum: [...VALID_TASK_SIZES], description: 'Estimated task size' },
                complexity: { type: 'string', enum: [...VALID_TASK_COMPLEXITIES], description: 'Estimated complexity' },
                startPhase: { type: 'string', enum: ['investigating', 'designing', 'planning', 'implementing'], description: 'Recommended starting phase' },
              },
              required: ['title', 'type', 'description', 'priority'],
            },
            description: 'Concrete improvement tasks to prevent similar defects in the future',
          },
        },
        required: ['rootCause', 'severity', 'responsibleAgents', 'analysis', 'promptImprovements', 'processImprovements', 'suggestedTasks'],
      },
    };
  }

  buildPrompt(context: AgentContext): string {
    const task = context.task;
    const additionalCtx = context.additionalContext ?? {};
    const rawLinked = additionalCtx.linkedBugDescriptions;
    const linkedBugDescriptions = Array.isArray(rawLinked) && rawLinked.every((v) => typeof v === 'string')
      ? (rawLinked as string[])
      : undefined;
    const rawPostMortemInput = task.metadata?.postMortemInput ?? additionalCtx.postMortemInput;
    const postMortemInput = typeof rawPostMortemInput === 'string' ? rawPostMortemInput : undefined;

    const lines: string[] = [
      'You are a post-mortem reviewer. Your job is to analyse a completed task that produced one or more defects',
      'and identify what went wrong so we can improve the development workflow.',
      '',
      '## Task Under Review',
      `Title: ${task.title}`,
    ];

    if (task.description) {
      lines.push('', '### Description', task.description);
    }

    if (task.plan) {
      lines.push('', '### Implementation Plan', task.plan);
    }

    if (task.technicalDesign) {
      lines.push('', '### Technical Design', task.technicalDesign);
    }

    if (context.taskContext && context.taskContext.length > 0) {
      lines.push('', '## Task History (context entries)');
      for (const entry of context.taskContext) {
        lines.push(`\n### [${entry.entryType}] — ${entry.source}`);
        lines.push(entry.summary ?? '(no summary)');
        if (entry.data && Object.keys(entry.data).length > 0) {
          lines.push('```json', JSON.stringify(entry.data, null, 2), '```');
        }
      }
    }

    if (linkedBugDescriptions && linkedBugDescriptions.length > 0) {
      lines.push('', '## Linked Bug Report(s)');
      for (let i = 0; i < linkedBugDescriptions.length; i++) {
        lines.push(`\n### Bug ${i + 1}`, linkedBugDescriptions[i]);
      }
    }

    if (postMortemInput) {
      lines.push(
        '',
        '## User Input: Expected vs. Actual',
        postMortemInput,
      );
    }

    lines.push(
      '',
      '## Instructions',
      '1. Review the task plan, technical design, implementation history, reviewer feedback, and linked bug reports above.',
      '2. Identify the ROOT CAUSE — not just the symptom. Ask "why?" repeatedly.',
      '3. Determine which phase of the workflow (planning, design, implementation, review) was responsible.',
      '4. Produce a structured post-mortem with:',
      '   - rootCause: the primary failure classification',
      '   - severity: how bad the defect was',
      '   - responsibleAgents: which agents should have caught this',
      '   - analysis: detailed explanation of what went wrong and why',
      '   - promptImprovements: specific prompt changes that would prevent this',
      '   - processImprovements: workflow/process changes that would prevent this',
      '   - suggestedTasks: concrete tasks to prevent similar defects (process/prompt improvements only)',
      '',
      '## Critical rules',
      '- Focus on SYSTEMIC improvements — changes to prompts, processes, and guards that prevent similar defects in ALL future tasks.',
      '- Do NOT suggest fixing the specific bug in the defective task — only suggest workflow improvements.',
      '- Every suggested task must be about improving the development process, not the specific code.',
      '- Be specific: reference exact sections of prompts, specific review steps, or concrete validation rules.',
    );

    return lines.join('\n');
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    return exitCode === 0 ? 'review_complete' : 'failed';
  }
}
