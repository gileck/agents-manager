import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseClaudeAgent } from './base-claude-agent';

export class ClaudeCodeAgent extends BaseClaudeAgent {
  readonly type = 'claude-code';

  protected getMaxTurns(context: AgentContext): number {
    switch (context.mode) {
      case 'plan':
      case 'plan_revision':
      case 'investigate':
      case 'technical_design':
      case 'technical_design_revision':
        return 150;
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
      case 'implement':
      case 'request_changes':
        return 30 * 60 * 1000; // 30 min — implementation tasks need more time
      case 'plan':
      case 'plan_revision':
      case 'investigate':
      case 'resolve_conflicts':
      case 'technical_design':
      case 'technical_design_revision':
        return 10 * 60 * 1000;
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
      case 'technical_design':
      case 'technical_design_revision':
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
            },
            required: ['technicalDesign', 'designSummary', 'subtasks'],
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
          '   - **Dependencies** — new packages, existing utilities to reuse',
          '   - **Testing Strategy** — what to test and how',
          '   - **Risk Assessment** — potential issues and mitigations',
          '',
          'Your output will be captured as structured JSON with three fields:',
          '- "technicalDesign": the full technical design document as markdown',
          '- "designSummary": a short 2-3 sentence summary of the technical design',
          '- "subtasks": an array of concrete implementation step names derived from the design',
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
          'Revise the technical design to address all feedback. Produce an updated design document.',
          '',
          'Your output will be captured as structured JSON with three fields:',
          '- "technicalDesign": the revised full technical design document as markdown',
          '- "designSummary": a short 2-3 sentence summary of the revised technical design',
          '- "subtasks": an array of concrete implementation step names derived from the design',
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
        if (task.technicalDesign) {
          rcLines.push('', '## Technical Design', task.technicalDesign);
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
      case 'technical_design': return 'design_ready';
      case 'technical_design_revision': return 'design_ready';
      case 'implement': return 'pr_ready';
      case 'request_changes': return 'pr_ready';
      case 'resolve_conflicts': return 'pr_ready';
      default: return 'completed';
    }
  }
}
