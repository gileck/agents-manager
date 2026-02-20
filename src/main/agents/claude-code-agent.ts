import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseClaudeAgent } from './base-claude-agent';

export class ClaudeCodeAgent extends BaseClaudeAgent {
  readonly type = 'claude-code';

  protected getMaxTurns(context: AgentContext): number {
    switch (context.mode) {
      case 'plan':
      case 'plan_revision':
      case 'investigate':
        return 100;
      case 'implement':
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
      case 'plan':
      case 'plan_revision':
      case 'investigate':
      case 'resolve_conflicts':
        return 5 * 60 * 1000;
      default:
        return 10 * 60 * 1000;
    }
  }

  protected getOutputFormat(context: AgentContext): object | undefined {
    switch (context.mode) {
      case 'plan':
      case 'plan_revision':
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
            },
            required: ['plan', 'planSummary', 'subtasks'],
          },
        };
      case 'investigate':
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
            },
            required: ['plan', 'investigationSummary', 'subtasks'],
          },
        };
      case 'implement':
        return {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: {
              summary: { type: 'string', description: 'A short summary of the changes implemented' },
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
          `Analyze this task and create a detailed implementation plan. Task: ${task.title}.${desc}`,
        ];
        if (task.planComments && task.planComments.length > 0) {
          planLines.push('', '## Admin Feedback');
          for (const comment of task.planComments) {
            const time = new Date(comment.createdAt).toLocaleString();
            planLines.push(`- **${comment.author}** (${time}): ${comment.content}`);
          }
        }
        planLines.push(
          ``,
          `Your output will be captured as structured JSON with three fields:`,
          `- "plan": the full implementation plan as markdown`,
          `- "planSummary": a short 2-3 sentence summary of the plan`,
          `- "subtasks": an array of concrete implementation step names`,
        );
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
          'Your output will be captured as structured JSON with three fields:',
          '- "plan": the revised full implementation plan as markdown',
          '- "planSummary": a short 2-3 sentence summary of the revised plan',
          '- "subtasks": an array of concrete implementation step names',
        );
        prompt = prLines.join('\n');
        break;
      }
      case 'implement': {
        const lines = [
          `Implement the changes for this task. After making all changes, stage and commit them with git (git add the relevant files, then git commit with a descriptive message). Task: ${task.title}.${desc}`,
        ];
        if (task.subtasks && task.subtasks.length > 0) {
          lines.push(
            '',
            '## IMPORTANT: Subtask Progress Tracking',
            'You MUST update subtask status via the `am` CLI as you work. Do NOT use TodoWrite — use these bash commands instead:',
            `  am tasks subtask update ${task.id} --name "<subtask name>" --status in_progress   # before starting a subtask`,
            `  am tasks subtask update ${task.id} --name "<subtask name>" --status done           # after completing a subtask`,
            '',
            'Current subtasks:',
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
        prompt = lines.join('\n');
        break;
      }
      case 'investigate': {
        const invLines = [
          `You are a bug investigator. Analyze the following bug report, investigate the root cause, and suggest a fix with concrete steps.`,
          ``,
          `Bug: ${task.title}.${desc}`,
          ``,
          `## Instructions`,
          `1. Read the bug report carefully — it may contain debug logs, error traces, timeline entries, and context from the reporter.`,
          `2. Use the CLI to gather additional debugging info about this task:`,
          `   - \`am tasks get ${task.id} --json\` — full task details`,
          `   - \`am events list --task ${task.id} --json\` — task event log`,
          `3. Investigate the codebase to find the root cause.`,
          `4. Write a detailed investigation report with your findings.`,
          `5. Suggest a concrete fix plan.`,
          `6. Break the fix into subtasks.`,
        ];
        // Include related task info if available in metadata
        const relatedTaskId = task.metadata?.relatedTaskId as string | undefined;
        if (relatedTaskId) {
          invLines.push(
            ``,
            `## Related Task`,
            `This bug references task \`${relatedTaskId}\`. Use the CLI to inspect it:`,
            `  am tasks get ${relatedTaskId} --json`,
            `  am events list --task ${relatedTaskId} --json`,
          );
        }
        if (task.subtasks && task.subtasks.length > 0) {
          invLines.push('', '## Subtasks');
          for (const st of task.subtasks) {
            invLines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
          }
        }
        invLines.push(
          ``,
          `Your output will be captured as structured JSON with three fields:`,
          `- "plan": a detailed investigation report as markdown (root cause analysis, findings, fix suggestion)`,
          `- "investigationSummary": a short 2-3 sentence summary of the investigation findings`,
          `- "subtasks": an array of concrete fix step names`,
        );
        prompt = invLines.join('\n');
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
          `2. Run \`git rebase origin/main\` to start the rebase.`,
          `3. For each conflict, open the conflicting files, resolve the conflicts, then \`git add\` the resolved files.`,
          `4. Run \`git rebase --continue\` after resolving each conflict.`,
          `5. Once the rebase is complete, verify the project builds (\`npm run build\` or equivalent).`,
          `6. Do NOT push — the pipeline will handle pushing after you finish.`,
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
        rcLines.push(
          ``,
          `## Instructions`,
          `1. Read the reviewer's feedback in the Task Context above carefully.`,
          `2. Fix every issue mentioned — do not skip or ignore any feedback.`,
          `3. After making all fixes, stage and commit with a descriptive message.`,
        );
        prompt = rcLines.join('\n');
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
      case 'investigate': return 'investigation_complete';
      case 'implement': return 'pr_ready';
      case 'request_changes': return 'pr_ready';
      case 'resolve_conflicts': return 'pr_ready';
      default: return 'completed';
    }
  }
}
