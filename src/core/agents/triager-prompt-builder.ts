import type { AgentContext, AgentConfig } from '../../shared/types';
import { VALID_TASK_TYPES } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { getInteractiveFields, getInteractiveInstructions, getTaskEstimationFields, getTaskEstimationInstructions } from './prompt-utils';

export class TriagerPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'triager';

  protected isReadOnly(): boolean {
    return true;
  }

  protected getMaxTurns(): number {
    return 30; // fast — 30s-2min target
  }

  protected getTimeout(_context: AgentContext, config: AgentConfig): number {
    return config.timeout || 2 * 60 * 1000; // 2 min default
  }

  protected getOutputFormat(): object {
    return {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          triageSummary: { type: 'string', description: '2-3 sentence summary of triage findings' },
          suggestedType: {
            type: 'string',
            enum: [...VALID_TASK_TYPES],
            description: 'Suggested task type classification',
          },
          suggestedTags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Suggested tags for the task (e.g., area:renderer, area:core, performance, ux)',
          },
          suggestedPhase: {
            type: 'string',
            enum: ['investigating', 'designing', 'planning', 'implementing', 'closed'],
            description: 'Recommended next pipeline phase after triage, or closed if task is not relevant',
          },
          phaseSkipJustification: {
            type: 'string',
            description: 'Why certain phases can be skipped (e.g., "XS bug fix — investigation and design are unnecessary")',
          },
          enrichedDescription: {
            type: 'string',
            description: 'Improved/expanded task description with structured requirements (what, why, acceptance criteria, affected areas)',
          },
          similarTaskIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of similar existing tasks (potential duplicates or related work)',
          },
          ...getTaskEstimationFields(),
          ...getInteractiveFields(),
        },
        required: ['triageSummary', 'suggestedType', 'size', 'complexity', 'suggestedPhase'],
      },
    };
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode } = context;
    const desc = task.description ? `\n${task.description}` : '';
    const amCli = `node bootstrap-cli.js`;

    let prompt: string;

    if (mode === 'revision') {
      const lines = [
        `Continue triaging this task using the user's feedback below.`,
        ``,
        `Task: ${task.title}${desc}`,
        ``,
        `## CLI Commands`,
        `Use the CLI to gather additional info about this task:`,
        `  - \`${amCli} tasks get ${task.id} --json\` — full task details`,
        `  - \`${amCli} tasks list --search "<keyword>" --json\` — search for similar tasks`,
      ];
      if (task.debugInfo) {
        lines.push('', '## Debug Info', '```', task.debugInfo, '```');
      }
      lines.push(
        '',
        '## Instructions',
        '1. Review the user\'s answers to your questions in the Task Context above.',
        '2. Use their input to refine your triage assessment.',
        '3. Update the task with your findings (see "Apply Changes" below).',
        '4. Provide your triage assessment in the structured output.',
      );
      lines.push('', ...this.getTriageInstructions(amCli, task.id));
      prompt = lines.join('\n');
    } else {
      const lines = [
        `You are a task triager. Quickly assess the following task to classify it, estimate effort, and determine the best starting pipeline phase.`,
        ``,
        `Task: ${task.title}${desc}`,
        ``,
        `## What Triage IS`,
        `- Classify the task type (bug, feature, improvement, etc.)`,
        `- Estimate size (xs/sm/md/lg/xl) and complexity (low/medium/high)`,
        `- Suggest tags for categorization`,
        `- Expand vague descriptions into structured requirements`,
        `- Surface similar/duplicate tasks`,
        `- Recommend which pipeline phase to start with (and justify skipping phases)`,
        ``,
        `## What Triage is NOT`,
        `- Do NOT write code or create branches`,
        `- Do NOT do deep technical investigation (that's the investigator's job)`,
        `- Do NOT create implementation plans (that's the planner's job)`,
        `- Keep it fast — surface-level codebase scan only (30s-2min target)`,
        ``,
        `## Efficiency Guardrails`,
        `- Avoid reading minified, compiled, or bundled files (node_modules, dist/, build/)`,
        `- Limit codebase scanning to identifying related files/areas — don't deep-dive`,
        `- Prefer Grep for targeted lookups over broad file reading`,
        ``,
        `## Instructions`,
        `1. Read the task title and description carefully.`,
        `2. Briefly scan the codebase (Grep, Glob) to identify related files/areas.`,
        `3. Classify the task type, estimate size and complexity.`,
        `4. If the description is vague, expand it into structured requirements (what, why, acceptance criteria, affected areas).`,
        `5. Search for similar tasks using the CLI: \`${amCli} tasks list --search "<keyword>" --json\``,
        `6. Determine the recommended starting phase:`,
        `   - Bugs with unclear root cause → investigating`,
        `   - Complex features or architectural changes → designing`,
        `   - Tasks needing plan breakdown → planning`,
        `   - Simple/clear tasks (xs/sm, low complexity) → implementing`,
        `7. Update the task with your findings (see "Apply Changes" below).`,
        `8. If the task is too vague to triage properly (e.g., "fix the thing", "make it better"), use the \`needs_info\` outcome to ask clarifying questions. Do NOT guess or hallucinate requirements.`,
      ];
      if (task.debugInfo) {
        lines.push('', '## Debug Info', '```', task.debugInfo, '```');
      }
      lines.push('', ...this.getTriageInstructions(amCli, task.id));
      prompt = lines.join('\n');
    }

    prompt += getTaskEstimationInstructions();
    prompt += getInteractiveInstructions(this.type);

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues and resubmit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  private getTriageInstructions(amCli: string, taskId: string): string[] {
    return [
      `## Apply Changes`,
      `Use the CLI to write your triage findings back to the task:`,
      `  - \`${amCli} tasks update ${taskId} --type <type> --size <size> --complexity <complexity>\` — set classification`,
      `  - \`${amCli} tasks update ${taskId} --tags <tag1>,<tag2>\` — add tags`,
      `  - \`${amCli} tasks update ${taskId} --description "<enriched description>"\` — update description if you expanded it`,
      ``,
      `Note: The structured output fields \`size\` and \`complexity\` will be applied to the task automatically.`,
      `For \`type\`, \`tags\`, and \`description\`, you must use the CLI commands above.`,
    ];
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'triage_complete';
  }
}
