import type { AgentContext, AgentRunResult } from '../../shared/types';
import type { AgentLibResult } from '../interfaces/agent-lib';
import { getActivePhase, getActivePhaseIndex, isMultiPhase } from '../../shared/phase-utils';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';

export interface ReviewComment {
  file: string;
  severity: 'must_fix' | 'should_fix' | 'nit';
  issue: string;
  suggestion: string;
}

interface ReviewStructuredOutput {
  verdict: 'approved' | 'changes_requested';
  summary: string;
  comments: ReviewComment[];
}

export class ReviewerPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'reviewer';

  protected isReadOnly(): boolean {
    return true;
  }

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
            items: {
              type: 'object',
              properties: {
                file: { type: 'string', description: 'File path the comment refers to' },
                severity: { type: 'string', enum: ['must_fix', 'should_fix', 'nit'], description: 'Severity level of the issue' },
                issue: { type: 'string', description: 'What is wrong' },
                suggestion: { type: 'string', description: 'What to change to fix it' },
              },
              required: ['file', 'severity', 'issue', 'suggestion'],
            },
            description: 'Structured review comments. Empty array if approved.',
          },
        },
        required: ['verdict', 'summary', 'comments'],
      },
    };
  }

  buildPrompt(context: AgentContext): string {
    const { task } = context;

    const hasPriorReview = context.taskContext?.some(
      e => e.entryType === 'review_feedback' || e.entryType === 'fix_summary'
    );

    const activePhase = getActivePhase(task.phases);
    const multiPhase = isMultiPhase(task);
    const defaultBranch = (context.project.config?.defaultBranch as string) || 'main';

    const lines: string[] = [];

    // Session-aware preamble: when resuming the implementor's session,
    // the reviewer already has full context — just provide directives.
    if (context.resumeSession) {
      if (hasPriorReview) {
        lines.push(
          'Now re-review the changes on this branch. The previous review issues should be fixed.',
          'Verify ALL previously requested changes were addressed before approving.',
        );
      } else {
        lines.push(
          'Now review the changes you just saw being implemented on this branch.',
        );
      }
      lines.push(
        '',
        `Run \`git diff origin/${defaultBranch}..HEAD\` to see all changes.`,
        '',
      );

      // Even with shared session, include phase scope constraints and subtask lists
      // — these are review directives, not context the session provides.
      if (multiPhase && activePhase) {
        const phaseIdx = getActivePhaseIndex(task.phases);
        const totalPhases = task.phases?.length ?? 0;
        const pendingPhases = (task.phases ?? []).filter(p => p.status === 'pending');

        lines.push(
          `## ⚠️ SCOPE: Phase ${phaseIdx + 1} of ${totalPhases} only — "${activePhase.name}"`,
          `This PR implements **only Phase ${phaseIdx + 1}**. Features belonging to later phases are intentionally absent.`,
          `Do NOT flag missing functionality that belongs to a later phase.`,
          '',
          `### Phase ${phaseIdx + 1} Deliverables — the ONLY things to check for completeness:`,
        );
        for (const st of activePhase.subtasks) {
          lines.push(`- ${st.name}`);
        }
        if (pendingPhases.length > 0) {
          lines.push('', `### Later phases (NOT part of this PR — do not flag as missing):`);
          for (const pp of pendingPhases) {
            lines.push(`- ${pp.name}`);
          }
        }
        lines.push('');
      } else if (task.subtasks && task.subtasks.length > 0) {
        lines.push('## Task Subtasks - ALL must be implemented:');
        for (const st of task.subtasks) {
          lines.push(`- ${st.name}`);
        }
        lines.push('');
      }
    } else if (multiPhase && activePhase) {
      const phaseIdx = getActivePhaseIndex(task.phases);
      const totalPhases = task.phases?.length ?? 0;
      const pendingPhases = (task.phases ?? []).filter(p => p.status === 'pending');
      const completedPhases = (task.phases ?? []).filter(p => p.status === 'completed');

      lines.push(
        `You are a code reviewer. Task: **${task.title}** (multi-phase, ${totalPhases} phases total).`,
        '',
        `## ⚠️ SCOPE: Phase ${phaseIdx + 1} of ${totalPhases} only — "${activePhase.name}"`,
        `This PR implements **only Phase ${phaseIdx + 1}**. Features belonging to later phases are intentionally absent.`,
        `Do NOT flag missing functionality that belongs to a later phase.`,
        '',
        `### Phase ${phaseIdx + 1} Deliverables — the ONLY things to check for completeness:`,
      );
      for (const st of activePhase.subtasks) {
        lines.push(`- ${st.name}`);
      }

      if (pendingPhases.length > 0) {
        lines.push('', `### Later phases (NOT part of this PR — do not flag as missing):`);
        for (const pp of pendingPhases) {
          lines.push(`- ${pp.name}`);
        }
      }
      if (completedPhases.length > 0) {
        lines.push('', `### Already merged phases (do not re-review):`);
        for (const cp of completedPhases) {
          lines.push(`- ${cp.name}${cp.prLink ? ` — ${cp.prLink}` : ''}`);
        }
      }
      lines.push('');

      if (hasPriorReview) {
        lines.push(
          `This is a RE-REVIEW. Check only that Phase ${phaseIdx + 1} issues raised previously are fixed.`,
          `⚠️ Ignore any prior requests for features that belong to later phases (listed above). Those will be implemented in separate PRs.`,
          '',
        );
      }
    } else {
      const desc = task.description ? ` ${task.description}` : '';
      lines.push(
        `You are a code reviewer. Review the changes in this branch for the following task: ${task.title}.${desc}`,
        '',
      );

      if (task.subtasks && task.subtasks.length > 0) {
        lines.push(
          '## Task Subtasks - ALL must be implemented:',
        );
        for (const st of task.subtasks) {
          lines.push(`- ${st.name}`);
        }
        lines.push('');
      }

      if (hasPriorReview) {
        lines.push(
          'This is a RE-REVIEW. Previous review feedback and fixes are in the Task Context above.',
          'Verify ALL previously requested changes were addressed before approving.',
          '',
        );
      }
    }

    // Steps section — simplified when session provides context
    if (context.resumeSession) {
      let step = 1;
      lines.push(
        '## Steps',
        `${step++}. Run \`git diff origin/${defaultBranch}..HEAD\` to see all changes made in this branch.`,
        `${step++}. For each changed file, read the full file to understand surrounding context. Check that changes are consistent with how the modified code is used elsewhere (imports, call sites, type contracts).`,
        `${step++}. Review the diff using the criteria below.`,
      );
      if ((multiPhase && activePhase) || (task.subtasks && task.subtasks.length > 0)) {
        lines.push(`${step++}. Verify each subtask is implemented by finding corresponding code changes in the diff.`);
      }
      lines.push(`${step}. **Make every comment actionable** — say what to change, not just what is wrong.`);
    } else {
      let step = 1;
      lines.push(
        '## Steps',
        `${step++}. Read CLAUDE.md or project conventions to understand project rules (package manager, restricted directories, code patterns).`,
        `${step++}. Read the architecture documentation in docs/ (especially docs/architecture-overview.md and docs/abstractions.md) to understand the system's layer boundaries, abstraction contracts, and separation of concerns.`,
        `${step++}. Run \`git diff origin/${defaultBranch}..HEAD\` to see all changes made in this branch.`,
        `${step++}. For each changed file, read the full file to understand surrounding context. Check that changes are consistent with how the modified code is used elsewhere (imports, call sites, type contracts).`,
        `${step++}. Review the diff using the criteria below.`,
      );

      if ((multiPhase && activePhase) || (task.subtasks && task.subtasks.length > 0)) {
        lines.push(`${step++}. Verify each subtask is implemented by finding corresponding code changes in the diff.`);
      }
      lines.push(
        `${step++}. Check that all changes comply with CLAUDE.md conventions. Flag any violation as a must-fix issue.`,
        `${step}. **Make every comment actionable** — say what to change, not just what is wrong.`,
      );
    }

    lines.push(
      '',
      '## Read-Only Constraint',
      'IMPORTANT: Do NOT modify the worktree. Do not run git stash, git checkout, git clean, git reset, or any file-modifying command. Use only read-only git commands (git diff, git log, git show, git blame). To check if an issue is pre-existing, compare the branch diff against origin/main rather than switching branches.',
      '',
      '## Review Criteria',
      '**Must-check (block if violated):**',
    );

    if (multiPhase && activePhase) {
      lines.push(`- Completeness — are all Phase ${getActivePhaseIndex(task.phases) + 1} deliverables above implemented?`);
    } else if (task.subtasks && task.subtasks.length > 0) {
      lines.push(
        '- Subtask Completeness — verify EACH subtask listed above has been implemented in the diff',
        '- If any subtask is missing, you MUST request changes and list the specific missing subtasks',
      );
    } else {
      lines.push('- Correctness — does the code do what the task requires?');
    }

    lines.push(
      '- Security — no hardcoded secrets, no SQL injection, no path traversal, no XSS',
      '- Data integrity — no silent data loss, no unhandled nulls in critical paths',
      '- CLAUDE.md compliance — any violation of documented project conventions is blocking',
      '- Architecture compliance — new code must respect documented architecture:',
      '  - Layer boundaries (no business logic outside services)',
      '  - Abstraction contracts (use interfaces, not implementation details)',
      '  - No leaking abstractions across documented boundaries',
      '  - New implementations registered through documented patterns',
      '  - Separation of concerns maintained as documented in docs/abstractions.md',
      '',
      '**Should-check (block if significant):**',
      '- Error handling — are failures surfaced, not swallowed?',
      '- Test coverage — are new code paths tested?',
      '- Code quality — duplication, overly complex logic, missing types',
      '- Context consistency — do changes fit with how the modified code is used in the rest of the codebase?',
      '',
      '**Nice-to-have (mention but do not block):**',
      '- Style nits, naming preferences, minor formatting',
      '',
      '## Approval Threshold',
    );

    if (multiPhase && activePhase) {
      lines.push(`Approve if all Phase ${getActivePhaseIndex(task.phases) + 1} deliverables are present, no must-check violations, and no significant should-check issues.`);
    } else if (task.subtasks && task.subtasks.length > 0) {
      lines.push(
        'Approve ONLY if:',
        '1. ALL subtasks listed above have been implemented (verify each one in the diff)',
        '2. There are no must-check violations',
        '3. There are no significant should-check issues',
        '',
        'If ANY subtask is missing from the implementation, you MUST request changes.',
      );
    } else {
      lines.push('Approve if there are no must-check violations and no significant should-check issues.');
    }

    lines.push(
      '',
      '## Output Fields',
      '- **verdict** — "approved" or "changes_requested"',
      '- **summary** — concise summary: how many files changed, how many issues found, how many blocking',
      '- **comments** — array of structured comment objects. Each comment has: `file` (path), `severity` ("must_fix" | "should_fix" | "nit"), `issue` (what is wrong), `suggestion` (what to change to fix it). Empty array if approved.',
    );

    if (context.devServerUrl) {
      lines.push(
        '',
        '## Dev Server',
        `The application dev server is running at: ${context.devServerUrl}`,
        'You can test the changes by visiting this URL in the browser.',
      );
    }

    return lines.join('\n');
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'approved';
  }

  buildResult(_context: AgentContext, libResult: AgentLibResult, outcome: string, prompt: string): AgentRunResult {
    const so = libResult.structuredOutput as ReviewStructuredOutput | undefined;
    const effectiveOutcome = so?.verdict ?? outcome;

    const result: AgentRunResult = {
      exitCode: libResult.exitCode,
      output: libResult.output,
      outcome: effectiveOutcome,
      error: libResult.error,
      costInputTokens: libResult.costInputTokens,
      costOutputTokens: libResult.costOutputTokens,
      cacheReadInputTokens: libResult.cacheReadInputTokens,
      cacheCreationInputTokens: libResult.cacheCreationInputTokens,
      totalCostUsd: libResult.totalCostUsd,
      structuredOutput: libResult.structuredOutput,
      prompt,
    };

    if (effectiveOutcome === 'changes_requested') {
      result.payload = {
        summary: so?.summary ?? libResult.output.slice(-500),
        comments: so?.comments ?? [],
      };
    }

    return result;
  }
}
