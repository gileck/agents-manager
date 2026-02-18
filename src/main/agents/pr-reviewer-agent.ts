import type { AgentContext, AgentRunResult } from '../../shared/types';
import { BaseClaudeAgent } from './base-claude-agent';

export class PrReviewerAgent extends BaseClaudeAgent {
  readonly type = 'pr-reviewer';

  buildPrompt(context: AgentContext): string {
    const { task } = context;
    const desc = task.description ? ` ${task.description}` : '';

    return [
      `You are a code reviewer. Review the changes in this branch for the following task: ${task.title}.${desc}`,
      '',
      'Steps:',
      '1. Run `git diff main..HEAD` to see all changes made in this branch.',
      '2. Review the diff for code quality, correctness, style, and completeness against the task description.',
      '3. Provide a concise review summary.',
      '4. End your output with exactly one of these verdicts on its own line:',
      '   REVIEW_VERDICT: APPROVED',
      '   REVIEW_VERDICT: CHANGES_REQUESTED',
      '',
      'If the changes look good, use APPROVED. If there are issues that need fixing, use CHANGES_REQUESTED and explain what needs to change.',
    ].join('\n');
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
