import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { getInteractiveFields, getInteractiveInstructions, getTaskEstimationFields, getTaskEstimationInstructions } from './prompt-utils';

export class InvestigatorPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'investigator';

  protected isReadOnly(): boolean {
    return true;
  }

  protected getMaxTurns(): number {
    return 150;
  }

  protected getTimeout(_context: AgentContext, config: AgentConfig): number {
    return config.timeout || 10 * 60 * 1000;
  }

  protected getOutputFormat(): object {
    return {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          investigationReport: { type: 'string', description: 'The detailed investigation report as markdown (root cause analysis, findings, fix suggestion)' },
          investigationSummary: { type: 'string', description: 'A short 2-3 sentence summary of the investigation findings for display in task context' },
          subtasks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Concrete fix steps that break down the suggested fix',
          },
          ...getTaskEstimationFields(),
          ...getInteractiveFields(),
        },
        required: ['investigationReport', 'investigationSummary', 'subtasks'],
      },
    };
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode } = context;
    const desc = task.description ? ` ${task.description}` : '';
    const invAmCli = `node bootstrap-cli.js`;

    let prompt: string;

    if (mode === 'revision') {
      // Investigation resume — triggered for all revision reasons (info_provided, investigation_feedback, etc.)
      const ivrLines = context.sessionId
        ? [
            `Continue investigating using the user's decisions below.`,
            ``,
            `Bug: ${task.title}.${desc}`,
          ]
        : [
            `Continue investigating this bug using the user's decisions.`,
            ``,
            `Bug: ${task.title}.${desc}`,
          ];
      ivrLines.push(
        ``,
        `## CLI Commands`,
        `Use the CLI to gather additional debugging info about this task:`,
        `  - \`${invAmCli} tasks get ${task.id} --json\` — full task details`,
        `  - \`${invAmCli} events list --task ${task.id} --json\` — task event log`,
      );
      if (task.subtasks && task.subtasks.length > 0) {
        ivrLines.push('', '## Subtasks');
        for (const st of task.subtasks) {
          ivrLines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
        }
      }
      if (task.debugInfo) {
        ivrLines.push('', '## Debug Info', '```', task.debugInfo, '```');
      }
      ivrLines.push(
        '',
        '## Instructions',
        '1. Read the project documentation file (CLAUDE.md) at the repository root to understand project conventions, architecture, and code patterns.',
        '2. Review the user\'s answers to your questions in the Task Context above.',
        '3. Use their decisions to guide your investigation.',
        '4. For targeted file lookups (when you know approximately what you are looking for — function names, file patterns, error strings), use Read, Grep, and Glob directly. Only spawn Task/Explore sub-agents when you need broad codebase discovery across unknown directories or when the search space is genuinely large. Do not run the same searches both directly and via a sub-agent.',
        '5. Write a detailed investigation report with your findings.',
        '6. Suggest a concrete fix plan, including any tests that should be added or updated.',
        '7. Break the fix into subtasks.',
      );
      ivrLines.push('', ...this.getReportStructureInstructions());
      prompt = ivrLines.join('\n');
    } else {
      // New investigation
      const invLines = [
        `You are a bug investigator. Analyze the following bug report, investigate the root cause, and suggest a fix with concrete steps.`,
        ``,
        `Bug: ${task.title}.${desc}`,
        ``,
        `## Efficiency Guardrails`,
        `- Avoid spending time reading minified, compiled, or bundled files (e.g. node_modules/**/*.mjs, dist/, build/). If you need to understand library behavior, prefer inferring it from the application code that calls it.`,
        `- Avoid re-reading the same file. Use Grep to find specific sections on subsequent lookups.`,
        `- Prefer direct Grep/Read for targeted lookups. When spawning an Explore sub-agent, scope it narrowly to a specific flow or question — not broad feature exploration.`,
        `- Do not run the same searches both directly and via a sub-agent.`,
        ``,
        `## Instructions`,
        `1. Read the bug report carefully — it may contain debug logs, error traces, timeline entries, and context from the reporter.`,
        `2. Investigate the codebase to find the root cause. The project documentation (CLAUDE.md) at the repository root contains architecture context if needed.`,
        `3. Write a detailed investigation report with your findings.`,
        `4. Check existing test coverage for the affected code and note any gaps.`,
        `5. Suggest a concrete fix plan, including any tests that should be added or updated.`,
        `6. Break the fix into subtasks.`,
      ];
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
      if (task.debugInfo) {
        invLines.push('', '## Debug Info', '```', task.debugInfo, '```');
      }
      if (task.subtasks && task.subtasks.length > 0) {
        invLines.push('', '## Subtasks');
        for (const st of task.subtasks) {
          invLines.push(`- [${st.status === 'done' ? 'x' : ' '}] ${st.name} (${st.status})`);
        }
      }
      invLines.push('', ...this.getReportStructureInstructions());
      prompt = invLines.join('\n');
    }

    prompt += getTaskEstimationInstructions();
    prompt += getInteractiveInstructions(this.type);

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues and resubmit your report:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  private getReportStructureInstructions(): string[] {
    return [
      `## Report Structure`,
      `Structure your investigation report with the following header format:`,
      ``,
      '```markdown',
      `# Investigation Report: [bug title]`,
      `# Summary: [Short summary of the report and findings]`,
      `# Root Cause: [Short summary of the root cause | 'Root Cause Not Found']`,
      `# Root Cause Confidence: [Very High | High | Mid | Low | None] — explanation of confidence level`,
      `# Suggested Fix Complexity (if applicable): [High | Mid | Low] — how complicated the suggested fix is`,
      ``,
      `[REST OF REPORT]`,
      '```',
    ];
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'investigation_complete';
  }
}
