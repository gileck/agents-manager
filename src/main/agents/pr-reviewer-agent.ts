import type { AgentContext, AgentRunResult } from '../../shared/types';
import { BaseClaudeAgent } from './base-claude-agent';

interface ReviewStructuredOutput {
  verdict: 'approved' | 'changes_requested';
  summary: string;
  comments: string[];
}

export class PrReviewerAgent extends BaseClaudeAgent {
  readonly type = 'pr-reviewer';

  protected getMaxTurns(_context: AgentContext): number {
    return 50;
  }

  protected getOutputFormat(_context: AgentContext): object | undefined {
    return {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          verdict: {
            type: 'string',
            enum: ['approved', 'changes_requested'],
            description: 'Whether the review approves the changes or requests modifications',
          },
          summary: {
            type: 'string',
            description: 'A concise summary of the review findings',
          },
          comments: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific review comments or issues found. Empty array if approved.',
          },
        },
        required: ['verdict', 'summary', 'comments'],
      },
    };
  }

  buildPrompt(context: AgentContext): string {
    const { task } = context;
    const desc = task.description ? ` ${task.description}` : '';

    const hasPriorReview = context.taskContext?.some(
      e => e.entryType === 'review_feedback' || e.entryType === 'fix_summary'
    );

    const lines = [
      `You are a code reviewer. Review the changes in this branch for the following task: ${task.title}.${desc}`,
      '',
    ];

    if (hasPriorReview) {
      lines.push(
        'This is a RE-REVIEW. Previous review feedback and fixes are in the Task Context above.',
        'Verify ALL previously requested changes were addressed before approving.',
        '',
      );
    }

    const defaultBranch = (context.project.config?.defaultBranch as string) || 'main';
    lines.push(
      '## Steps',
      `1. Run \`git diff ${defaultBranch}..HEAD\` to see all changes made in this branch.`,
      '2. Review the diff using the criteria below.',
      '3. Make every comment actionable — say what to change, not just what is wrong.',
      '',
      '## Review Criteria',
      '**Must-check (block if violated):**',
      '- Correctness — does the code do what the task requires?',
      '- Security — no hardcoded secrets, no SQL injection, no path traversal, no XSS',
      '- Data integrity — no silent data loss, no unhandled nulls in critical paths',
      '',
      '**Should-check (block if significant):**',
      '- Error handling — are failures surfaced, not swallowed?',
      '- Test coverage — are new code paths tested?',
      '- Code quality — duplication, overly complex logic, missing types',
      '',
      '**Nice-to-have (mention but do not block):**',
      '- Style nits, naming preferences, minor formatting',
      '',
      '## Approval Threshold',
      'Approve if there are no must-check violations and no significant should-check issues.',
    );

    return lines.join('\n');
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'approved';
  }

  buildResult(exitCode: number, output: string, outcome: string, error?: string, costInputTokens?: number, costOutputTokens?: number, structuredOutput?: Record<string, unknown>, prompt?: string): AgentRunResult {
    const so = structuredOutput as ReviewStructuredOutput | undefined;
    const effectiveOutcome = so?.verdict ?? outcome;

    const result: AgentRunResult = {
      exitCode,
      output,
      outcome: effectiveOutcome,
      error,
      costInputTokens,
      costOutputTokens,
      structuredOutput,
      prompt,
    };

    if (effectiveOutcome === 'changes_requested') {
      result.payload = {
        summary: so?.summary ?? output.slice(-500),
        comments: so?.comments ?? [],
      };
    }

    return result;
  }
}
