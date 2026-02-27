import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';

export class TaskWorkflowReviewerPromptBuilder extends BaseAgentPromptBuilder {
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
            description: 'Overall assessment of the workflow execution',
          },
          executionSummary: {
            type: 'string',
            description: '2-4 sentence end-to-end summary of how the workflow executed',
          },
          findings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: ['efficiency', 'infrastructure', 'process', 'error_handling', 'cost'],
                },
                severity: {
                  type: 'string',
                  enum: ['info', 'warning', 'critical'],
                },
                title: { type: 'string', description: 'Root cause title, not a symptom description' },
                detail: { type: 'string', description: 'Root cause analysis explaining WHY the issue happened at the system level' },
              },
              required: ['category', 'severity', 'title', 'detail'],
            },
            description: 'Root-cause findings about the workflow infrastructure (not the task-specific implementation)',
          },
          promptImprovements: {
            type: 'array',
            items: { type: 'string' },
            description: 'Suggestions for improving agent prompts so future agents perform better',
          },
          processImprovements: {
            type: 'array',
            items: { type: 'string' },
            description: 'Suggestions for improving workflow infrastructure: guards, hooks, transitions, timeouts',
          },
          tokenCostAnalysis: {
            type: 'string',
            description: 'Token usage efficiency observations with root causes for waste',
          },
          suggestedTasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Actionable task title (imperative form, e.g. "Add guard to prevent duplicate agent spawns")' },
                description: { type: 'string', description: 'Detailed description including: what to fix, why, the specific source files and functions to modify, and enough context for an agent to implement it without additional investigation' },
                priority: { type: 'number', enum: [0, 1, 2, 3], description: 'Priority: 0=P0 Critical, 1=P1 High, 2=P2 Medium, 3=P3 Low' },
              },
              required: ['title', 'description', 'priority'],
            },
            description: 'Concrete tasks to fix WORKFLOW INFRASTRUCTURE issues (prompts, guards, hooks, transitions). NEVER suggest tasks to fix the specific task code — only tasks that improve the system for ALL future executions.',
          },
        },
        required: ['overallVerdict', 'executionSummary', 'findings', 'promptImprovements', 'processImprovements', 'tokenCostAnalysis', 'suggestedTasks'],
      },
    };
  }

  buildPrompt(_context: AgentContext): string {
    return [
      'You are a workflow infrastructure reviewer. A complete execution report has been written to',
      '.task-review-report.txt in your working directory.',
      '',
      '## Your role',
      'You review the GENERIC WORKFLOW — the system of prompts, guards, hooks, transitions, and',
      'agent orchestration. You do NOT review the task-specific implementation or code quality.',
      'Think of yourself as reviewing the factory, not the product it made.',
      '',
      '## Critical rules',
      '- NEVER comment on whether the agent wrote good or bad code. That is not your job.',
      '- NEVER suggest code fixes or improvements to the task implementation.',
      '- If an agent produced poor output, ask WHY the prompt/workflow allowed that — what should',
      '  change in the prompt, guards, hooks, or transitions so that ANY future agent does better?',
      '- Every finding must be a ROOT CAUSE, not a symptom. Ask "why?" repeatedly until you reach',
      '  the system-level cause. Example:',
      '  - BAD (symptom): "Two agents ran concurrently and wasted tokens"',
      '  - GOOD (root cause): "The start_agent hook fires as fire_and_forget, and the transition',
      '    from implementing→pr_review does not wait for hook completion before the outcome resolver',
      '    processes the next event — this allows a second agent to be spawned before the first',
      '    registers in the guard check"',
      '',
      '## How to navigate the report',
      'The file uses [[ MARKER ]] tags. Key markers:',
      '- [[ SUMMARY:START/END ]] — High-level overview. READ THIS FIRST.',
      '- [[ AGENT_RUN:START id=... type=... mode=... status=... ]] — Agent run headers.',
      '- [[ AGENT_RUN_OUTPUT:START id=... ]] — Full agent output for a specific run.',
      '- [[ AGENT_RUN_PROMPT:START id=... ]] — Full prompt used for a run.',
      '- [[ EVENT ... severity=warning/error ]] — Grep for warnings/errors across all events.',
      '- [[ HOOK:START name=... ]] — Hook execution details.',
      '- [[ ARTIFACT type=diff ]] — Code diff (scan briefly for scope, do NOT review code quality).',
      '',
      '## Investigation workflow',
      '1. Read the SUMMARY section (first ~50 lines) using Read tool.',
      '2. Grep for "AGENT_RUN:START" to see all runs at a glance.',
      '3. Grep for "severity=warning" and "severity=error" to find trouble spots.',
      '4. For each issue found, INVESTIGATE the root cause:',
      '   - Read the agent prompts — was the prompt missing guidance that caused the problem?',
      '   - Read the events around the issue — did guards/hooks behave correctly?',
      '   - Check transitions — did the pipeline route correctly?',
      '   - Check timing — were there race conditions or unnecessary delays?',
      '5. Produce your structured review with root-cause findings.',
      '',
      '## Review criteria (all about the workflow, never about task implementation)',
      '- **Efficiency**: Did the workflow orchestrate agents without unnecessary retries, duplicate',
      '  runs, or wasted work? If agents did redundant work, what in the prompt or orchestration',
      '  caused it?',
      '- **Infrastructure**: Did guards, hooks, and transitions function correctly? Were there race',
      '  conditions, ghost runs, or timing issues in the pipeline engine?',
      '- **Process**: Did the pipeline flow (plan→implement→review→merge) work smoothly? Were',
      '  transitions triggered at the right time? Did outcome resolution work correctly?',
      '- **Error handling**: Were failures retried appropriately? Did the system recover gracefully?',
      '  Were errors surfaced or silently swallowed?',
      '- **Cost**: Were tokens used efficiently? If tokens were wasted, what systemic cause led to',
      '  the waste (e.g., overly broad prompts, missing stop conditions, duplicate agent spawns)?',
      '',
      '## Output guidance',
      '- Findings should be actionable at the SYSTEM level — things we can fix in prompts, guards,',
      '  hooks, transitions, or agent configuration to improve ALL future task executions.',
      '- promptImprovements: specific changes to agent prompt templates that would prevent issues.',
      '- processImprovements: changes to guards, hooks, transitions, timeouts, or orchestration logic.',
      '- suggestedTasks: concrete tasks that will be auto-created to fix WORKFLOW issues.',
      '  CRITICAL: These must ONLY be about improving the workflow infrastructure (prompts, guards,',
      '  hooks, transitions, orchestration). NEVER suggest fixing the specific task code.',
      '  Example of WRONG task: "Fix the sorting bug in sortGroupEntries"',
      '  Example of RIGHT task: "Improve PR reviewer prompt to catch edge cases in sorting logic"',
      '  Each task description MUST include:',
      '    - The specific source file paths and functions/methods to modify',
      '    - What the current behavior is and what it should be changed to',
      '    - Enough context for an implementation agent to start coding without investigation',
      '  Set priority based on impact: 0=Critical (data loss, blocking), 1=High (significant waste),',
      '  2=Medium (minor inefficiency), 3=Low (nice-to-have improvement).',
      '  Use empty array if no workflow improvements are needed.',
      '- If the workflow executed cleanly with no systemic issues, say so — do not invent findings.',
    ].join('\n');
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    return exitCode === 0 ? 'review_complete' : 'failed';
  }
}
