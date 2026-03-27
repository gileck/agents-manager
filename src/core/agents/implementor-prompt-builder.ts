import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { formatFeedbackForPrompt, formatFeedbackAsContext, getInteractiveFields, getInteractiveInstructions } from './prompt-utils';
import { getActivePhase, getActivePhaseIndex, isMultiPhase } from '../../shared/phase-utils';
import { buildDocsPromptSections } from './doc-injection';

export class ImplementorPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'implementor';

  protected isReadOnly(): boolean {
    return false;
  }

  protected getExcludedFeedbackTypes(): string[] {
    return ['plan_feedback', 'design_feedback'];
  }

  protected getMaxTurns(context: AgentContext): number {
    if (context.revisionReason === 'uncommitted_changes') return 50;
    if (context.revisionReason === 'merge_failed') return 100;
    return 200;
  }

  protected getTimeout(context: AgentContext, config: AgentConfig): number {
    if (config.timeout) return config.timeout;
    if (context.revisionReason === 'uncommitted_changes') return 5 * 60 * 1000;
    if (context.revisionReason === 'merge_failed') return 15 * 60 * 1000;
    return 30 * 60 * 1000;
  }

  protected getOutputFormat(context: AgentContext): object | undefined {
    const { mode, revisionReason } = context;

    if (mode === 'new' || (mode === 'revision' && revisionReason === 'info_provided')) {
      // implement / implement_resume
      return {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'A short summary of the changes implemented' },
            ...getInteractiveFields(),
          },
          required: ['summary'],
        },
      };
    }
    if (mode === 'revision' && revisionReason === 'changes_requested') {
      // request_changes
      return {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'A short summary of the fixes made to address reviewer feedback' },
          },
          required: ['summary'],
        },
      };
    }
    if (mode === 'revision' && revisionReason === 'merge_failed') {
      // resolve merge failure (conflicts, failing checks, etc.)
      return {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'A short summary of how the merge failure was resolved' },
          },
          required: ['summary'],
        },
      };
    }
    if (mode === 'revision' && revisionReason === 'uncommitted_changes') {
      // commit uncommitted work left by a prior run
      return {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'A short summary of what was committed' },
          },
          required: ['summary'],
        },
      };
    }
    return undefined;
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode, revisionReason } = context;
    const desc = this.formatTaskDescription(task);

    let prompt: string;

    if (mode === 'revision' && revisionReason === 'changes_requested') {
      // request_changes
      const rcLines: string[] = [];

      if (context.sessionId) {
        // Minimal prompt — session history provides full prior context
        rcLines.push(
          `Address ALL feedback below.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
      } else {
        // Fallback: verbose prompt for sessions without history
        rcLines.push(
          `Changes have been requested on this branch.`,
          `You MUST address ALL feedback from the Task Context above.`,
          ``,
          `Task: ${task.title}.${desc}`,
        );
      }

      // Surface user change_request entries prominently so they aren't buried in the Task Context
      const userChangeRequests = (context.taskContext ?? []).filter(
        (e) => e.entryType === 'change_request' && e.source === 'user',
      );
      if (userChangeRequests.length > 0) {
        rcLines.push('', '## USER CHANGE REQUESTS (HIGH PRIORITY)');
        rcLines.push('The following change requests were submitted directly by the user. Address these FIRST:');
        for (const cr of userChangeRequests) {
          rcLines.push('', `> ${cr.summary.replace(/\n/g, '\n> ')}`);
        }
        rcLines.push('');
      }

      if (!context.sessionId) {
        // Only include full plan/design in verbose fallback mode
        const docsSection = buildDocsPromptSections(context.docs ?? [], 'plan');
        if (docsSection) {
          rcLines.push(docsSection);
        }
        rcLines.push(...formatFeedbackAsContext(context.taskContext, ['plan_feedback'], 'Plan Review Comments'));
        rcLines.push(...formatFeedbackForPrompt(context.taskContext, ['implementation_feedback'], 'Implementation Feedback'));
        rcLines.push(...formatFeedbackAsContext(context.taskContext, ['design_feedback'], 'Design Review Comments'));
      } else {
        // In session-resume mode, still include all unaddressed feedback
        rcLines.push(...formatFeedbackAsContext(context.taskContext, ['plan_feedback'], 'Plan Review Comments'));
        rcLines.push(...formatFeedbackForPrompt(context.taskContext, ['implementation_feedback'], 'Implementation Feedback'));
        rcLines.push(...formatFeedbackAsContext(context.taskContext, ['design_feedback'], 'Design Review Comments'));
      }

      rcLines.push(
        ``,
        `## Instructions`,
        `1. Read ALL feedback carefully — both user change requests (above) and reviewer feedback in the Task Context.`,
        `2. Fix every issue mentioned — do not skip or ignore any feedback.`,
        `3. Do not make unrelated changes — only fix what was asked for.`,
        `4. In the \`summary\` field, describe what you changed and how you addressed the feedback.`,
        `5. Run \`yarn checks\` (or the project's equivalent) to ensure TypeScript and lint pass.`,
        `6. Stage and commit with a descriptive message that references which feedback was addressed.`,
        `7. **Rebase onto origin/main before finishing:** run \`git fetch origin && git rebase origin/main\`. If there are merge conflicts, resolve them (preserve the intent of both sides), \`git add\` the resolved files, and \`git rebase --continue\`. After the rebase, re-run \`yarn checks\`. If checks fail, compare against \`origin/main\` — if the same failures exist on main, they are pre-existing and should be ignored. Do not spend time debugging pre-existing issues. If tests fail due to **timeouts**, retry with an extended timeout: \`TEST_TIMEOUT=60000 yarn checks\`.`,
      );
      prompt = rcLines.join('\n');
    } else if (mode === 'revision' && revisionReason === 'merge_failed') {
      // resolve merge failure (conflicts, failing CI checks, etc.)
      const mfLines = [
        `The branch for this task has merge conflicts or the PR merge failed. Fix the issue so the branch can be merged cleanly.`,
        ``,
        `Task: ${task.title}.${desc}`,
      ];

      // Surface merge failure details from task context (if available — present when triggered from merge_pr hook)
      const mergeFailures = (context.taskContext ?? [])
        .filter(e => e.entryType === 'merge_failure')
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

      if (mergeFailures.length > 0) {
        const latest = mergeFailures[0];
        mfLines.push('', '## Merge Failure Details');
        mfLines.push(`- **Error:** ${latest.summary}`);
        if (latest.data.prUrl) mfLines.push(`- **PR:** ${latest.data.prUrl}`);
        if (latest.data.mergeable) mfLines.push(`- **Mergeable status:** ${latest.data.mergeable}`);
        if (latest.data.mergeStateStatus) mfLines.push(`- **Merge state:** ${latest.data.mergeStateStatus}`);

        const failingChecks = latest.data.failingChecks as Array<{ name: string; status: string; url?: string }> | undefined;
        if (failingChecks && failingChecks.length > 0) {
          mfLines.push('', '### Failing CI Checks');
          for (const check of failingChecks) {
            mfLines.push(`- **${check.name}**: ${check.status}${check.url ? ` (${check.url})` : ''}`);
          }
        }
      }

      mfLines.push(
        '',
        '## Instructions',
        '1. Run `git fetch origin` to get the latest main.',
        '2. Read the conflicting files and understand both sides before rebasing — know what main changed and what this branch changed.',
        '3. Run `git rebase origin/main` to start the rebase.',
        '4. For each conflict, resolve by preserving the intent of both changes, then `git add` the resolved files.',
        '5. Run `git rebase --continue` after resolving each conflict.',
        '6. If the merge failure was caused by **failing CI checks** (see details above), investigate and fix the code issues.',
        '7. Once the rebase is complete, run `yarn checks` (or the project equivalent). If checks fail, compare against `origin/main` — if the same failures exist on main, they are pre-existing and should be ignored. If tests fail due to **timeouts**, retry with an extended timeout: `TEST_TIMEOUT=60000 yarn checks`.',
        '8. Do NOT push — the pipeline will handle pushing after you finish.',
      );
      prompt = mfLines.join('\n');
    } else if (mode === 'revision' && revisionReason === 'uncommitted_changes') {
      // commit uncommitted work left by a prior run that failed to commit
      const ucLines = [
        `Your previous run edited files but failed to commit them. The worktree has uncommitted changes that need to be committed.`,
        ``,
        `Task: ${task.title}.${desc}`,
        ``,
        `## Instructions`,
        `1. Run \`git status\` to see the uncommitted changes.`,
        `2. Run \`git diff\` to review what was changed.`,
        `3. If the changes look correct, stage and commit them with a descriptive message.`,
        `4. If any changes look incomplete or broken, fix them first, then commit.`,
        `5. Run \`yarn checks\` (or the project's equivalent) to verify TypeScript and lint pass. If checks fail, compare against \`origin/main\` — if the same failures exist on main, they are pre-existing and should be ignored. If tests fail due to **timeouts**, retry with an extended timeout: \`TEST_TIMEOUT=60000 yarn checks\`.`,
        `6. **Rebase onto origin/main before finishing:** run \`git fetch origin && git rebase origin/main\`. If there are merge conflicts, resolve them, \`git add\` the resolved files, and \`git rebase --continue\`. After the rebase, re-run \`yarn checks\`.`,
      ];
      prompt = ucLines.join('\n');
    } else if (mode === 'revision' && revisionReason === 'info_provided') {
      // implement_resume
      const irLines = context.sessionId
        ? [
            `Continue implementing using the user's decisions below.`,
            ``,
            `Task: ${task.title}.${desc}`,
          ]
        : [
            `Continue implementing the changes for this task using the user's decisions. Task: ${task.title}.${desc}`,
          ];
      // Phase-aware subtask display
      const irActivePhase = getActivePhase(task.phases);
      if (isMultiPhase(task) && irActivePhase) {
        const irPhaseIdx = getActivePhaseIndex(task.phases);
        const irTotalPhases = task.phases?.length ?? 0;
        irLines.push(
          '',
          `## Current Phase: ${irActivePhase.name} (${irPhaseIdx + 1}/${irTotalPhases})`,
          '',
          '## IMPORTANT: Subtask Progress Tracking',
          'Create a todo list with the following subtasks and update their status as you work through them:',
          '',
        );
        for (const st of irActivePhase.subtasks) {
          irLines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
        }
        irLines.push('');
      } else if (task.subtasks && task.subtasks.length > 0) {
        irLines.push(
          '',
          '## IMPORTANT: Subtask Progress Tracking',
          'Create a todo list with the following subtasks and update their status as you work through them:',
          '',
        );
        for (const st of task.subtasks) {
          irLines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
        }
        irLines.push('');
      }
      if (!context.sessionId) {
        const irDocsSection = buildDocsPromptSections(context.docs ?? [], 'plan');
        if (irDocsSection) {
          irLines.push(irDocsSection);
        }
      }
      irLines.push(
        '',
        '## Instructions',
        '1. Review the user\'s answers to your questions in the Task Context above.',
        '2. Use their decisions to guide your implementation.',
        '3. Follow existing patterns — match the style of surrounding code. Make focused changes only.',
        '4. Run `yarn checks` (or the project\'s equivalent) to ensure TypeScript and lint pass before committing.',
        '5. Stage and commit with a descriptive message.',
        '6. **Rebase onto origin/main before finishing:** run `git fetch origin && git rebase origin/main`. If there are merge conflicts, resolve them (preserve the intent of both sides), `git add` the resolved files, and `git rebase --continue`. After the rebase, re-run `yarn checks`. If checks fail, compare against `origin/main` — if the same failures exist on main, they are pre-existing and should be ignored. Do not spend time debugging pre-existing issues.',
      );
      prompt = irLines.join('\n');
    } else {
      // implement (new)
      const lines = [
        `Implement the changes for this task. Task: ${task.title}.${desc}`,
        ``,
        `## Instructions`,
        `1. Read CLAUDE.md (or project conventions file) to understand project rules — package manager, restricted directories, code patterns, error handling rules. Follow these rules throughout your implementation.`,
        `2. Read the architecture documentation in docs/ (especially docs/architecture-overview.md and docs/abstractions.md) to understand layer boundaries, abstraction contracts, and separation of concerns. Your implementation must respect these boundaries.`,
        `3. **Read the files you will modify first.** If the task description names a specific file path and function/method, open those files directly — do not spawn an Explore subagent. If you do delegate to an Explore subagent, wait for its result before issuing any further search or read calls — do not search in parallel. Understand existing patterns, naming conventions, and code style before writing anything.`,
        `4. **If the plan includes an Assumptions section**, verify each UNVERIFIED assumption by reading the relevant code before making any edits. If an assumption is wrong, report it via \`needs_info\` with details — do not try to work around a broken assumption.`,
        `5. Follow existing patterns — match the style of surrounding code.`,
        `6. Respect architecture boundaries: business logic goes in services (src/core/services/), use interfaces (src/core/interfaces/) not implementation details, do not leak abstractions across documented boundaries.`,
        `7. Make focused changes — only modify what is necessary for this task.`,
        `8. Ensure no security vulnerabilities: no hardcoded secrets, no SQL injection, no path traversal, no XSS. Follow OWASP top 10 guidelines.`,
        `9. Add or update tests for new code paths. If the project has existing test patterns, follow them.`,
        `10. Surface errors properly — do not swallow failures with empty catch blocks. Follow the project's error handling patterns documented in CLAUDE.md.`,
        `11. After making all changes, run \`yarn checks\` (or the project's equivalent) to ensure TypeScript and lint pass. Fix any errors before committing.`,
        `12. Stage and commit with a descriptive message (git add the relevant files, then git commit).`,
        `13. **Rebase onto origin/main before finishing:** run \`git fetch origin && git rebase origin/main\`. If there are merge conflicts, resolve them (preserve the intent of both sides), \`git add\` the resolved files, and \`git rebase --continue\`. After the rebase, re-run \`yarn checks\`. If checks fail, compare against \`origin/main\` — if the same failures exist on main, they are pre-existing and should be ignored. Do not spend time debugging pre-existing issues. If tests fail due to **timeouts**, retry with an extended timeout: \`TEST_TIMEOUT=60000 yarn checks\`.`,
      ];
      // Phase-aware subtask display
      const activePhase = getActivePhase(task.phases);
      if (isMultiPhase(task) && activePhase) {
        const phaseIdx = getActivePhaseIndex(task.phases);
        const totalPhases = task.phases?.length ?? 0;
        lines.push(
          '',
          `## Current Phase: ${activePhase.name} (${phaseIdx + 1}/${totalPhases})`,
          'You are implementing ONLY this phase. Focus on the subtasks listed below.',
        );
        const completedPhases = (task.phases ?? []).filter(p => p.status === 'completed');
        if (completedPhases.length > 0) {
          lines.push('', '### Previously Completed Phases');
          for (const cp of completedPhases) {
            lines.push(`- ${cp.name} (completed${cp.prLink ? `, PR: ${cp.prLink}` : ''})`);
          }
        }
        lines.push(
          '',
          '## IMPORTANT: Subtask Progress Tracking',
          'Create a todo list with the following subtasks and update their status as you work through them:',
          '',
        );
        for (const st of activePhase.subtasks) {
          lines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
        }
        lines.push('');
      } else if (task.subtasks && task.subtasks.length > 0) {
        lines.push(
          '',
          '## IMPORTANT: Subtask Progress Tracking',
          'Create a todo list with the following subtasks and update their status as you work through them:',
          '',
        );
        for (const st of task.subtasks) {
          lines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
        }
        lines.push('');
      }
      const newDocsSection = buildDocsPromptSections(context.docs ?? [], 'plan');
      if (newDocsSection) {
        lines.push(newDocsSection);
      }
      lines.push(...formatFeedbackAsContext(context.taskContext, ['plan_feedback'], 'Plan Review Comments'));
      lines.push(...formatFeedbackAsContext(context.taskContext, ['design_feedback'], 'Design Review Comments'));
      prompt = lines.join('\n');
    }

    // Append interactive question instructions for modes that support it (new and info_provided)
    if (mode === 'new' || (mode === 'revision' && revisionReason === 'info_provided')) {
      prompt += getInteractiveInstructions(this.type);
    }

    prompt = this.appendValidationErrors(prompt, context, ', then stage and commit');

    if (context.devServerUrl) {
      prompt += `\n\n## Dev Server\nThe application dev server is running at: ${context.devServerUrl}\nYou can test your changes by visiting this URL in the browser.`;
    }

    return prompt;
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'pr_ready';
  }
}
