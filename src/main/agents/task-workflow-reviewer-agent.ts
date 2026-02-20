import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseClaudeAgent } from './base-claude-agent';

export class TaskWorkflowReviewerAgent extends BaseClaudeAgent {
  readonly type = 'task-workflow-reviewer';

  protected getMaxTurns(_context: AgentContext): number {
    return 50;
  }

  protected getTimeout(_context: AgentContext, config: AgentConfig): number {
    return config.timeout || 5 * 60 * 1000;
  }

  protected getOutputFormat(_context: AgentContext): object | undefined {
    return {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          overallVerdict: {
            type: 'string',
            enum: ['good', 'needs_improvement', 'problematic'],
            description: 'Overall assessment of task execution quality',
          },
          executionSummary: {
            type: 'string',
            description: '2-4 sentence end-to-end summary of how the task was executed',
          },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: ['efficiency', 'quality', 'process', 'error_handling', 'cost'],
                },
                severity: {
                  type: 'string',
                  enum: ['info', 'warning', 'critical'],
                },
                title: { type: 'string' },
                detail: { type: 'string' },
              },
              required: ['category', 'severity', 'title', 'detail'],
            },
            description: 'Specific findings from the review',
          },
          codeImprovements: {
            type: 'array',
            items: { type: 'string' },
            description: 'Code quality improvement suggestions',
          },
          processImprovements: {
            type: 'array',
            items: { type: 'string' },
            description: 'Workflow/process improvement suggestions',
          },
          tokenCostAnalysis: {
            type: 'string',
            description: 'Token usage efficiency observations',
          },
        },
        required: ['overallVerdict', 'executionSummary', 'findings', 'codeImprovements', 'processImprovements', 'tokenCostAnalysis'],
      },
    };
  }

  buildPrompt(_context: AgentContext): string {
    return [
      'You are a task workflow reviewer. A complete execution report has been written to',
      '.task-review-report.txt in your working directory.',
      '',
      '## How to navigate the report',
      'The file uses [[ MARKER ]] tags. Key markers:',
      '- [[ SUMMARY:START/END ]] — High-level overview. READ THIS FIRST.',
      '- [[ AGENT_RUN:START id=... type=... mode=... status=... ]] — Agent run headers. Grep to get an index.',
      '- [[ AGENT_RUN_OUTPUT:START id=... ]] — Full agent output for a specific run.',
      '- [[ AGENT_RUN_PROMPT:START id=... ]] — Full prompt used for a run.',
      '- [[ EVENT ... severity=warning/error ]] — Grep for warnings/errors across all events.',
      '- [[ HOOK:START name=... ]] — Hook execution details.',
      '- [[ ARTIFACT type=diff ]] — Code diff.',
      '',
      '## Workflow',
      '1. Read the SUMMARY section (first ~50 lines) using Read tool.',
      '2. Grep for "AGENT_RUN:START" to see all runs at a glance.',
      '3. Grep for "severity=warning" and "severity=error" to find trouble spots.',
      '4. Drill into specific agent outputs or events as needed.',
      '5. Review the code diff via [[ ARTIFACT type=diff ]] section.',
      '6. Produce your structured review.',
      '',
      '## Review criteria',
      '- **Efficiency**: Was the task completed without unnecessary retries, wasted tokens, or circular agent work?',
      '- **Quality**: Did the agents produce good plans and implementations? Were there code quality issues?',
      '- **Process**: Did transitions happen correctly? Were guards and hooks executed properly?',
      '- **Error handling**: Were failures handled gracefully? Did retries succeed?',
      '- **Cost**: Were tokens used efficiently? Could the same result be achieved with fewer tokens?',
      '',
      '## Important',
      '- Be specific in your findings — reference agent run IDs, event timestamps, or specific issues.',
      '- Focus on actionable findings, not obvious observations.',
      '- The verdict should reflect the overall execution quality, not the code quality alone.',
    ].join('\n');
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    return exitCode === 0 ? 'review_complete' : 'failed';
  }
}
