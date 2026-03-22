import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';

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
          investigationSummary: { type: 'string', description: 'A short 2-3 sentence summary of the investigation findings, root cause, and recommended fix approach' },
        },
        required: ['investigationReport', 'investigationSummary'],
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
        '5. Analyze the architectural context of the bug — look beyond the immediate trigger to understand what design decision, missing abstraction, or coupling pattern allowed this bug to exist.',
        '6. Write a detailed investigation report with your findings.',
        '7. Present multiple fix options at different depths (direct fix, architectural fix, and balanced approach where applicable), including any tests that should be added or updated.',
      );
      ivrLines.push('', ...this.getReportStructureInstructions());
      prompt = ivrLines.join('\n');
    } else {
      // New investigation
      const invLines = [
        `You are a bug investigator. Analyze the following bug report, investigate the root cause, and suggest a fix.`,
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
        `3. Analyze the architectural context of the bug — look beyond the immediate trigger to understand what design decision, missing abstraction, or coupling pattern allowed this bug to exist. Consider whether this is a symptom of a deeper issue.`,
        `4. Write a detailed investigation report with your findings.`,
        `5. Check existing test coverage for the affected code and note any gaps.`,
        `6. Present multiple fix options at different depths (direct fix, architectural fix, and balanced approach where applicable), including any tests that should be added or updated.`,
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
      invLines.push('', ...this.getReportStructureInstructions());
      prompt = invLines.join('\n');
    }

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues and resubmit your report:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  private getReportStructureInstructions(): string[] {
    return [
      `## Report Structure`,
      `Structure your investigation report with the following format:`,
      ``,
      '```markdown',
      `# Investigation Report: [bug title]`,
      `**Summary:** [2-3 sentence summary]`,
      `**Root Cause:** [what's broken and why]`,
      `**Root Cause Confidence:** [High | Mid | Low]`,
      ``,
      `## Architectural Analysis`,
      `[Why does this bug exist? What design decision or missing abstraction allowed it?`,
      `Is this a symptom of a deeper pattern in the codebase?]`,
      ``,
      `## Fix Options`,
      ``,
      `### Option 1: Direct Fix`,
      `[Minimal change to fix the immediate bug. Describe the change, affected files,`,
      `and what architectural debt remains.]`,
      ``,
      `### Option 2: Architectural Fix`,
      `[Deeper refactor that addresses the underlying design issue. Describe the approach,`,
      `scope, and how it improves the codebase long-term.]`,
      ``,
      `### Option 3: Balanced Approach`,
      `[Middle ground — fixes the bug properly while making targeted improvements`,
      `without a full refactor. May not exist for every bug.]`,
      '```',
    ];
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'investigation_complete';
  }
}
