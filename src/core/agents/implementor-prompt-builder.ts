import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { formatFeedbackForPrompt, formatFeedbackAsContext, getInteractiveFields, getInteractiveInstructions } from './prompt-utils';
import { getActivePhase, getActivePhaseIndex, isMultiPhase } from '../../shared/phase-utils';

export class ImplementorPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'implementor';

  protected isReadOnly(): boolean {
    return false;
  }

  protected getExcludedFeedbackTypes(): string[] {
    return ['plan_feedback', 'design_feedback'];
  }

  protected getMaxTurns(context: AgentContext): number {
    if (context.revisionReason === 'conflicts_detected') return 50;
    return 200;
  }

  protected getTimeout(context: AgentContext, config: AgentConfig): number {
    if (config.timeout) return config.timeout;
    if (context.revisionReason === 'conflicts_detected') return 10 * 60 * 1000;
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
    if (mode === 'revision' && revisionReason === 'conflicts_detected') {
      // resolve_conflicts
      return {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'A short summary of how merge conflicts were resolved' },
          },
          required: ['summary'],
        },
      };
    }
    return undefined;
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode, revisionReason } = context;
    const desc = task.description ? ` ${task.description}` : '';

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
        if (task.plan) {
          rcLines.push('', '## Plan', task.plan);
        }
        rcLines.push(...formatFeedbackAsContext(context.taskContext, ['plan_feedback'], 'Plan Review Comments'));
        rcLines.push(...formatFeedbackForPrompt(context.taskContext, ['implementation_feedback'], 'Implementation Feedback'));
        if (task.technicalDesign) {
          rcLines.push('', '## Technical Design', task.technicalDesign);
        }
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
        `7. **Rebase onto origin/main before finishing:** run \`git fetch origin && git rebase origin/main\`. If there are merge conflicts, resolve them (preserve the intent of both sides), \`git add\` the resolved files, and \`git rebase --continue\`. After the rebase, re-run \`yarn checks\`. If checks fail, compare against \`origin/main\` — if the same failures exist on main, they are pre-existing and should be ignored. Do not spend time debugging pre-existing issues.`,
      );
      prompt = rcLines.join('\n');
    } else if (mode === 'revision' && revisionReason === 'conflicts_detected') {
      // resolve_conflicts
      const conflictLines = [
        `The branch for this task has merge conflicts with origin/main. Resolve them so the branch can be pushed cleanly.`,
        ``,
        `Task: ${task.title}.${desc}`,
        ``,
        `## Instructions`,
        `1. Run \`git fetch origin\` to get the latest main.`,
        `2. Read the conflicting files and understand both sides before rebasing — know what main changed and what this branch changed.`,
        `3. Run \`git rebase origin/main\` to start the rebase.`,
        `4. For each conflict, resolve by preserving the intent of both changes, then \`git add\` the resolved files.`,
        `5. Run \`git rebase --continue\` after resolving each conflict.`,
        `6. Once the rebase is complete, run \`yarn checks\` (or the project's equivalent). If checks fail, compare against \`origin/main\` — if the same failures exist on main, they are pre-existing and should be ignored. Do not spend time debugging pre-existing issues.`,
        `7. Do NOT push — the pipeline will handle pushing after you finish.`,
      ];
      prompt = conflictLines.join('\n');
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
        if (task.plan) {
          irLines.push('', '## Plan', task.plan);
        }
        if (task.technicalDesign) {
          irLines.push('', '## Technical Design', task.technicalDesign);
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
        `1. **Read the files you will modify first.** If the task description names a specific file path and function/method, open those files directly — do not spawn an Explore subagent. If you do delegate to an Explore subagent, wait for its result before issuing any further search or read calls — do not search in parallel. Understand existing patterns, naming conventions, and code style before writing anything.`,
        `2. **If the plan includes an Assumptions section**, verify each UNVERIFIED assumption by reading the relevant code before making any edits. If an assumption is wrong, report it via \`needs_info\` with details — do not try to work around a broken assumption.`,
        `3. Follow existing patterns — match the style of surrounding code.`,
        `4. Make focused changes — only modify what is necessary for this task.`,
        `5. After making all changes, run \`yarn checks\` (or the project's equivalent) to ensure TypeScript and lint pass. Fix any errors before committing.`,
        `6. Stage and commit with a descriptive message (git add the relevant files, then git commit).`,
        `7. **Rebase onto origin/main before finishing:** run \`git fetch origin && git rebase origin/main\`. If there are merge conflicts, resolve them (preserve the intent of both sides), \`git add\` the resolved files, and \`git rebase --continue\`. After the rebase, re-run \`yarn checks\`. If checks fail, compare against \`origin/main\` — if the same failures exist on main, they are pre-existing and should be ignored. Do not spend time debugging pre-existing issues.`,
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
      if (task.plan) {
        lines.push('', '## Plan', task.plan);
      }
      lines.push(...formatFeedbackAsContext(context.taskContext, ['plan_feedback'], 'Plan Review Comments'));
      if (task.technicalDesign) {
        lines.push('', '## Technical Design', task.technicalDesign);
      }
      lines.push(...formatFeedbackAsContext(context.taskContext, ['design_feedback'], 'Design Review Comments'));
      prompt = lines.join('\n');
    }

    // Append interactive question instructions for modes that support it (new and info_provided)
    if (mode === 'new' || (mode === 'revision' && revisionReason === 'info_provided')) {
      prompt += getInteractiveInstructions(this.type);
    }

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

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
