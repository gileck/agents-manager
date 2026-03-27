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
          investigationReport: { type: 'string', description: 'The detailed investigation report as markdown (root cause analysis, findings, architectural analysis). Do NOT embed fix options in this report — use the proposedOptions field instead.' },
          investigationSummary: { type: 'string', description: 'A short 2-3 sentence summary of the investigation findings, root cause, and recommended fix approach' },
          proposedOptions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'A kebab-case identifier, e.g. "direct-fix", "architectural-fix", "balanced-approach"' },
                label: { type: 'string', description: 'Short label starting with a size tier: "S — Direct Fix: ...", "M — Balanced Approach: ...", "L — Architectural Fix: ..."' },
                description: { type: 'string', description: 'Markdown description with effort estimate, approach summary, affected files, and tradeoffs' },
                recommended: { type: 'boolean', description: 'Set to true for the single recommended option' },
              },
              required: ['id', 'label', 'description'],
            },
            description: 'Structured fix options when multiple viable approaches exist at different effort/risk levels. Omit or leave empty when there is a single clear approach.',
          },
        },
        required: ['investigationReport', 'investigationSummary'],
      },
    };
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode } = context;
    const desc = this.formatTaskDescription(task);
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
        '6. Write a detailed investigation report with your findings (root cause, architectural analysis). Do NOT embed fix options in the report body.',
        '7. If multiple viable fix approaches exist at different effort/risk levels, populate the `proposedOptions` structured output field with each option. If there is a single clear fix, you may omit `proposedOptions`. Include any tests that should be added or updated in the option descriptions.',
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
        `4. Write a detailed investigation report with your findings (root cause, architectural analysis). Do NOT embed fix options in the report body.`,
        `5. Check existing test coverage for the affected code and note any gaps.`,
        `6. If multiple viable fix approaches exist at different effort/risk levels, populate the \`proposedOptions\` structured output field with each option (S/M/L tiers). If there is a single clear fix, you may omit \`proposedOptions\`. Include test changes needed in the option descriptions.`,
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

    prompt = this.appendValidationErrors(prompt, context, ' and resubmit your report');

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
      '```',
      ``,
      `**IMPORTANT:** Do NOT embed fix options in the report body. Instead, use the structured \`proposedOptions\` field in the JSON output.`,
      ``,
      `## Fix Options (proposedOptions field)`,
      `When you identify multiple viable fix approaches at different effort/risk levels, populate the \`proposedOptions\` array in your structured output. When there is a single obvious fix, you may omit \`proposedOptions\` entirely.`,
      ``,
      `Each option should have:`,
      `- **id**: kebab-case identifier (e.g. "direct-fix", "architectural-fix", "balanced-approach")`,
      `- **label**: Start with a size tier — "S — Direct Fix: [brief description]", "M — Balanced Approach: [brief description]", "L — Architectural Fix: [brief description]"`,
      `- **description**: Markdown with effort estimate, approach summary, affected files, and tradeoffs`,
      `- **recommended**: Set to \`true\` for the single recommended option`,
      ``,
      `Typical options:`,
      `1. **S — Direct Fix**: Minimal change to fix the immediate bug. Note what architectural debt remains.`,
      `2. **L — Architectural Fix**: Deeper refactor addressing the underlying design issue. Note scope and long-term benefit.`,
      `3. **M — Balanced Approach** (when applicable): Middle ground — fixes the bug properly with targeted improvements without a full refactor.`,
    ];
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'investigation_complete';
  }
}
