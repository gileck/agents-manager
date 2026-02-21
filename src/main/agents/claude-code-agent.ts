import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseClaudeAgent } from './base-claude-agent';

/** Shared schema fields that let any agent ask interactive questions. */
function getInteractiveFields(): Record<string, object> {
  return {
    outcome: {
      type: 'string',
      enum: ['needs_info'],
      description: 'Set to "needs_info" ONLY if you need user input before proceeding. Leave unset when work is complete.',
    },
    questions: {
      type: 'array',
      description: 'Questions for the user (only when outcome="needs_info"). Max 5.',
      items: {
        type: 'object',
        properties: {
          id:       { type: 'string', description: 'Unique question identifier (e.g. "q1")' },
          question: { type: 'string', description: 'The question text' },
          context:  { type: 'string', description: 'Why you need this answered' },
          options:  {
            type: 'array',
            description: 'Options to choose from (omit for free-text questions)',
            items: {
              type: 'object',
              properties: {
                id:          { type: 'string' },
                label:       { type: 'string' },
                description: { type: 'string' },
                recommended: { type: 'boolean' },
              },
              required: ['id', 'label', 'description'],
            },
          },
        },
        required: ['id', 'question'],
      },
    },
  };
}

/** Prompt section telling agents they can ask interactive questions. */
function getInteractiveInstructions(mode: string): string {
  const base = [
    '',
    '## Interactive Questions',
    'If you encounter ambiguity or need user input before proceeding, you can ask questions:',
    '- Set `outcome` to `"needs_info"` in your output',
    '- Provide a `questions` array with your questions (max 5)',
    '- Each question has: `id`, `question`, optional `context`, optional `options[]`',
    '- For multiple-choice: include `options` with `id`, `label`, `description`, and optionally `recommended: true`',
    '- The user can also add custom text to any answer',
    '- Only ask when genuinely needed — do not ask if you can make a reasonable decision yourself',
  ];
  if (mode === 'technical_design' || mode === 'technical_design_revision') {
    base.push(
      '',
      'For technical design, it is often valuable to propose multiple solution approaches.',
      'When there are genuinely different viable approaches, present them as options with',
      'clear descriptions including tradeoffs, pros/cons, and mark one as recommended.',
    );
  }
  return base.join('\n');
}

export class ClaudeCodeAgent extends BaseClaudeAgent {
  readonly type = 'claude-code';

  protected getMaxTurns(context: AgentContext): number {
    switch (context.mode) {
      case 'plan':
      case 'plan_revision':
      case 'plan_resume':
      case 'investigate':
      case 'investigate_resume':
      case 'technical_design':
      case 'technical_design_revision':
      case 'technical_design_resume':
        return 150;
      case 'implement':
      case 'implement_resume':
      case 'request_changes':
        return 200;
      case 'resolve_conflicts':
        return 50;
      default:
        return 100;
    }
  }

  protected getTimeout(context: AgentContext, config: AgentConfig): number {
    if (config.timeout) return config.timeout;
    switch (context.mode) {
      case 'implement':
      case 'implement_resume':
      case 'request_changes':
        return 30 * 60 * 1000; // 30 min — implementation tasks need more time
      case 'plan':
      case 'plan_revision':
      case 'plan_resume':
      case 'investigate':
      case 'investigate_resume':
      case 'resolve_conflicts':
      case 'technical_design':
      case 'technical_design_revision':
      case 'technical_design_resume':
        return 10 * 60 * 1000;
      default:
        return 10 * 60 * 1000;
    }
  }

  protected getOutputFormat(context: AgentContext): object | undefined {
    switch (context.mode) {
      case 'plan':
      case 'plan_revision':
      case 'plan_resume':
        return {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              plan: { type: 'string', description: 'The full implementation plan as markdown' },
              planSummary: { type: 'string', description: 'A short 2-3 sentence summary of the plan for display in task context' },
              subtasks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Concrete implementation steps that break down the plan',
              },
              ...getInteractiveFields(),
            },
            required: ['plan', 'planSummary', 'subtasks'],
          },
        };
      case 'investigate':
      case 'investigate_resume':
        return {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              plan: { type: 'string', description: 'The detailed investigation report as markdown (root cause analysis, findings, fix suggestion)' },
              investigationSummary: { type: 'string', description: 'A short 2-3 sentence summary of the investigation findings for display in task context' },
              subtasks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Concrete fix steps that break down the suggested fix',
              },
              ...getInteractiveFields(),
            },
            required: ['plan', 'investigationSummary', 'subtasks'],
          },
        };
      case 'technical_design':
      case 'technical_design_revision':
      case 'technical_design_resume':
        return {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              technicalDesign: { type: 'string', description: 'The full technical design document as markdown' },
              designSummary: { type: 'string', description: 'A short 2-3 sentence summary of the technical design' },
              subtasks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Concrete implementation steps derived from the design',
              },
              ...getInteractiveFields(),
            },
            required: ['technicalDesign', 'designSummary', 'subtasks'],
          },
        };
      case 'implement':
      case 'implement_resume':
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
      case 'request_changes':
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
      case 'resolve_conflicts':
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
      default:
        return undefined;
    }
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode } = context;
    const desc = task.description ? ` ${task.description}` : '';

    let prompt: string;
    switch (mode) {
      case 'plan': {
        const planLines = [
          `You are a senior software engineer. Analyze this task and create a detailed implementation plan. Task: ${task.title}.${desc}`,
          ``,
          `## Instructions`,
          `1. **Explore the codebase first.** Read relevant files, understand the directory structure, and identify existing patterns before planning.`,
          `2. Describe the current state — what exists today and what needs to change.`,
          `3. Outline your approach — the high-level strategy, key decisions, and any alternatives you considered.`,
          `4. List specific files to create or modify, with a short description of each change.`,
          `5. Identify edge cases, error handling, and potential risks.`,
          `6. Break the plan into 3-8 concrete subtasks. Each subtask should be independently testable and ordered by dependency.`,
        ];
        if (task.planComments && task.planComments.length > 0) {
          planLines.push('', '## Admin Feedback');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            planLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        prompt = planLines.join('\n');
        break;
      }
      case 'plan_revision': {
        const prLines = [
          `The admin has reviewed the current plan and requested changes. Revise the plan based on their feedback.`,
          ``,
          `Task: ${task.title}.${desc}`,
        ];
        if (task.plan) {
          prLines.push('', '## Current Plan', task.plan);
        }
        if (task.planComments && task.planComments.length > 0) {
          prLines.push('', '## Admin Feedback');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            prLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        prLines.push(
          '',
          '## Revision Guidelines',
          '- Address every piece of feedback — do not skip or partially address any comment.',
          '- If feedback is ambiguous, interpret it in the most reasonable way and note your interpretation.',
          '- Keep parts of the plan that were not criticized — only revise what the feedback targets.',
        );
        prompt = prLines.join('\n');
        break;
      }
      case 'implement': {
        const lines = [
          `Implement the changes for this task. Task: ${task.title}.${desc}`,
          ``,
          `## Instructions`,
          `1. **Read the files you will modify first.** Understand existing patterns, naming conventions, and code style before writing anything.`,
          `2. Follow existing patterns — match the style of surrounding code.`,
          `3. Make focused changes — only modify what is necessary for this task.`,
          `4. After making all changes, run \`yarn checks\` (or the project's equivalent) to ensure TypeScript and lint pass. Fix any errors before committing.`,
          `5. Stage and commit with a descriptive message (git add the relevant files, then git commit).`,
        ];
        if (task.subtasks && task.subtasks.length > 0) {
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
        if (task.planComments && task.planComments.length > 0) {
          lines.push('', '## Plan Comments');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            lines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        if (task.technicalDesign) {
          lines.push('', '## Technical Design', task.technicalDesign);
        }
        prompt = lines.join('\n');
        break;
      }
      case 'investigate': {
        const invAmCli = `node ${context.project.path}/bootstrap-cli.js`;
        const invLines = [
          `You are a bug investigator. Analyze the following bug report, investigate the root cause, and suggest a fix with concrete steps.`,
          ``,
          `Bug: ${task.title}.${desc}`,
          ``,
          `## Instructions`,
          `1. Read the bug report carefully — it may contain debug logs, error traces, timeline entries, and context from the reporter.`,
          `2. Use the CLI to gather additional debugging info about this task:`,
          `   - \`${invAmCli} tasks get ${task.id} --json\` — full task details`,
          `   - \`${invAmCli} events list --task ${task.id} --json\` — task event log`,
          `3. Investigate the codebase to find the root cause.`,
          `4. Attempt to reproduce the issue — run relevant commands or tests to confirm the bug.`,
          `5. Write a detailed investigation report with your findings.`,
          `6. Check existing test coverage for the affected code and note any gaps.`,
          `7. Suggest a concrete fix plan, including any tests that should be added or updated.`,
          `8. Break the fix into subtasks.`,
        ];
        // Include related task info if available in metadata
        const relatedTaskId = task.metadata?.relatedTaskId as string | undefined;
        if (relatedTaskId) {
          invLines.push(
            ``,
            `## Related Task`,
            `This bug references task \`${relatedTaskId}\`. Use the CLI to inspect it:`,
            `  ${invAmCli} tasks get ${relatedTaskId} --json`,
            `  ${invAmCli} events list --task ${relatedTaskId} --json`,
          );
        }
        if (task.subtasks && task.subtasks.length > 0) {
          invLines.push('', '## Subtasks');
          for (const st of task.subtasks) {
            invLines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
          }
        }
        prompt = invLines.join('\n');
        break;
      }
      case 'technical_design': {
        const tdLines = [
          `You are a software architect. Produce a detailed technical design document for the following task.`,
          ``,
          `Task: ${task.title}.${desc}`,
        ];
        if (task.plan) {
          tdLines.push('', '## Plan', task.plan);
        }
        if (task.planComments && task.planComments.length > 0) {
          tdLines.push('', '## Plan Comments');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            tdLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        tdLines.push(
          '',
          '## Instructions',
          '1. Read the task description and the existing plan carefully.',
          '2. Explore the codebase thoroughly — file structure, patterns, existing implementations.',
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
        break;
      }
      case 'technical_design_revision': {
        const tdrLines = [
          `The admin has reviewed the current technical design and requested changes. Revise the design based on their feedback.`,
          ``,
          `Task: ${task.title}.${desc}`,
        ];
        if (task.plan) {
          tdrLines.push('', '## Plan', task.plan);
        }
        if (task.technicalDesign) {
          tdrLines.push('', '## Current Technical Design', task.technicalDesign);
        }
        if (task.technicalDesignComments && task.technicalDesignComments.length > 0) {
          tdrLines.push('', '## Admin Feedback on Design');
          for (const comment of task.technicalDesignComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            tdrLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        tdrLines.push(
          '',
          '## Revision Guidelines',
          '- Address every piece of feedback — do not skip or partially address any comment.',
          '- If feedback conflicts with a technical constraint, explain the constraint and propose an alternative that satisfies the intent.',
          '- Keep parts of the design that were not criticized — only revise what the feedback targets.',
          '- Produce an updated design document.',
        );
        prompt = tdrLines.join('\n');
        break;
      }
      case 'resolve_conflicts': {
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
          `6. Once the rebase is complete, run \`yarn checks\` (or the project's equivalent) to ensure TypeScript and lint pass.`,
          `7. Do NOT push — the pipeline will handle pushing after you finish.`,
        ];
        prompt = conflictLines.join('\n');
        break;
      }
      case 'request_changes': {
        const rcLines = [
          `A code reviewer has reviewed the changes on this branch and requested changes.`,
          `You MUST address ALL of the reviewer's feedback from the Task Context above.`,
          ``,
          `Task: ${task.title}.${desc}`,
        ];
        if (task.plan) {
          rcLines.push('', '## Plan', task.plan);
        }
        if (task.planComments && task.planComments.length > 0) {
          rcLines.push('', '## Plan Comments');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            rcLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        if (task.technicalDesign) {
          rcLines.push('', '## Technical Design', task.technicalDesign);
        }
        rcLines.push(
          ``,
          `## Instructions`,
          `1. Read the reviewer's feedback in the Task Context above carefully.`,
          `2. Fix every issue mentioned — do not skip or ignore any feedback.`,
          `3. Do not make unrelated changes — only fix what the reviewer asked for.`,
          `4. Run \`yarn checks\` (or the project's equivalent) to ensure TypeScript and lint pass.`,
          `5. Stage and commit with a descriptive message that references which reviewer feedback was addressed.`,
        );
        prompt = rcLines.join('\n');
        break;
      }
      case 'plan_resume': {
        const prLines = [
          `You are a senior software engineer. Continue creating the implementation plan for this task using the user's decisions.`,
          ``,
          `Task: ${task.title}.${desc}`,
        ];
        if (task.planComments && task.planComments.length > 0) {
          prLines.push('', '## Admin Feedback');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            prLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        prLines.push(
          '',
          '## Instructions',
          '1. Review the user\'s answers to your questions in the Task Context above.',
          '2. Use their decisions to guide your implementation plan.',
          '3. **Explore the codebase** to ground your plan in real file paths and existing patterns.',
          '4. Produce a complete implementation plan with 3-8 concrete, independently testable subtasks ordered by dependency.',
        );
        prompt = prLines.join('\n');
        break;
      }
      case 'implement_resume': {
        const irLines = [
          `Continue implementing the changes for this task using the user's decisions. Task: ${task.title}.${desc}`,
        ];
        if (task.subtasks && task.subtasks.length > 0) {
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
        if (task.plan) {
          irLines.push('', '## Plan', task.plan);
        }
        if (task.technicalDesign) {
          irLines.push('', '## Technical Design', task.technicalDesign);
        }
        irLines.push(
          '',
          '## Instructions',
          '1. Review the user\'s answers to your questions in the Task Context above.',
          '2. Use their decisions to guide your implementation.',
          '3. Follow existing patterns — match the style of surrounding code. Make focused changes only.',
          '4. Run `yarn checks` (or the project\'s equivalent) to ensure TypeScript and lint pass before committing.',
          '5. Stage and commit with a descriptive message.',
        );
        prompt = irLines.join('\n');
        break;
      }
      case 'investigate_resume': {
        const ivrLines = [
          `Continue investigating this bug using the user's decisions.`,
          ``,
          `Bug: ${task.title}.${desc}`,
        ];
        if (task.subtasks && task.subtasks.length > 0) {
          ivrLines.push('', '## Subtasks');
          for (const st of task.subtasks) {
            ivrLines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
          }
        }
        ivrLines.push(
          '',
          '## Instructions',
          '1. Review the user\'s answers to your questions in the Task Context above.',
          '2. Use their decisions to guide your investigation.',
          '3. Write a detailed investigation report with your findings.',
          '4. Suggest a concrete fix plan, including any tests that should be added or updated.',
          '5. Break the fix into subtasks.',
        );
        prompt = ivrLines.join('\n');
        break;
      }
      case 'technical_design_resume': {
        const tdrLines = [
          `You are a software architect. Continue the technical design for this task using the user's decisions.`,
          ``,
          `Task: ${task.title}.${desc}`,
        ];
        if (task.plan) {
          tdrLines.push('', '## Plan', task.plan);
        }
        if (task.technicalDesign) {
          tdrLines.push('', '## Previous Technical Design', task.technicalDesign);
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
        break;
      }
      default:
        prompt = `${task.title}.${desc}`;
    }

    // Modes with structured output get their summary via the schema.
    // For other modes, ask for a textual summary section.
    if (!this.getOutputFormat(context)) {
      prompt += '\n\nWhen you are done, end your response with a "## Summary" section that briefly describes what you did.';
    }

    // Append interactive question instructions for modes that support it
    const interactiveModes = new Set([
      'plan', 'plan_revision', 'plan_resume',
      'implement', 'implement_resume',
      'investigate', 'investigate_resume',
      'technical_design', 'technical_design_revision', 'technical_design_resume',
    ]);
    if (interactiveModes.has(mode)) {
      prompt += getInteractiveInstructions(mode);
    }

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  inferOutcome(mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    switch (mode) {
      case 'plan': return 'plan_complete';
      case 'plan_revision': return 'plan_complete';
      case 'plan_resume': return 'plan_complete';
      case 'investigate': return 'investigation_complete';
      case 'investigate_resume': return 'investigation_complete';
      case 'technical_design': return 'design_ready';
      case 'technical_design_revision': return 'design_ready';
      case 'technical_design_resume': return 'design_ready';
      case 'implement': return 'pr_ready';
      case 'implement_resume': return 'pr_ready';
      case 'request_changes': return 'pr_ready';
      case 'resolve_conflicts': return 'pr_ready';
      default: return 'completed';
    }
  }
}
