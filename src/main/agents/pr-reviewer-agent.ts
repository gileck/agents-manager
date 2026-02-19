import type { AgentContext, AgentRunResult } from '../../shared/types';
import { BaseClaudeAgent } from './base-claude-agent';

export class PrReviewerAgent extends BaseClaudeAgent {
  readonly type = 'pr-reviewer';

  protected getMaxTurns(_context: AgentContext): number {
    return 50;
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

    lines.push(
      'Steps:',
      '1. Run `git diff main..HEAD` to see all changes made in this branch.',
      '2. Review the diff for code quality, correctness, style, and completeness against the task description.',
      '3. Provide a concise review.',
      '4. End your response with a "## Summary" section briefly describing your review findings.',
      '5. End your output with exactly one of these verdicts on its own line:',
      '   REVIEW_VERDICT: APPROVED',
      '   REVIEW_VERDICT: CHANGES_REQUESTED',
      '',
      'If the changes look good, use APPROVED. If there are issues that need fixing, use CHANGES_REQUESTED and explain what needs to change.',
    );

    return lines.join('\n');
  }

  inferOutcome(_mode: string, exitCode: number, output: string): string {
    if (exitCode !== 0) return 'failed';
    if (output.includes('REVIEW_VERDICT: CHANGES_REQUESTED')) return 'changes_requested';
    return 'approved';
  }

  buildResult(exitCode: number, output: string, outcome: string, error?: string, costInputTokens?: number, costOutputTokens?: number): AgentRunResult {
    const result: AgentRunResult = { exitCode, output, outcome, error, costInputTokens, costOutputTokens };

    if (outcome === 'changes_requested') {
      result.payload = {
        summary: output.slice(-500),
        comments: [],
      };
    }

    return result;
  }
}
