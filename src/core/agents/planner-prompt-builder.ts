import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { formatFeedbackForPrompt, getInteractiveFields, getInteractiveInstructions, getTaskEstimationFields, getTaskEstimationInstructions } from './prompt-utils';

const PLAN_HEADER_FORMAT = [
  '',
  '## Plan Header Format',
  'The plan MUST begin with this exact structure. Each field MUST be on its own line, separated by blank lines:',
  '',
  '# [Plan Title]',
  '[1-2 sentence description of what the plan does]',
  '',
  '**Complexity:** [Low / Medium / High] - [brief explanation of why]',
  '**Effort:** [XS / SM / MD / LG / XL] - [brief explanation of why]',
  '**Confidence:** [High / Medium / Low] - [brief explanation of why]',
  '**Main Risks:** None',
  '',
  'Or if there are main risks:',
  '',
  '**Main Risks:**',
  '1. [Risk description - where the approach could go wrong or unknowns]',
  '2. [Risk description]',
  '',
  'IMPORTANT: Each of these fields (Complexity, Effort, Confidence, Main Risks) MUST be on a SEPARATE line with a blank line before the first field. Do NOT combine them into a single paragraph.',
  '',
  '**Confidence** = how confident you are that implementing this plan as described will fully accomplish the task.',
  '- **High** — approach is well-understood, no significant unknowns.',
  '- **Medium** — approach is reasonable but some aspects are unverified or depend on assumptions.',
  '- **Low** — significant unknowns remain; the approach may need revision during implementation.',
  '',
  'Main Risks are ONLY major risks — places where the plan could go wrong or there are unknowns about whether the approach will work.',
  'Use "None" when there are no significant risks. Do NOT list minor edge cases here — those belong in the "Edge cases & risks" section later in the plan.',
].join('\n');

const MULTI_PHASE_INSTRUCTIONS = [
  '',
  '## Multi-Phase Tasks',
  'Only for genuinely large tasks (10+ files across multiple domains). Most tasks should use flat subtasks.',
  'If needed, provide 2-4 phases in the "phases" array. When using phases, leave "subtasks" empty.',
].join('\n');

const UI_COMPONENT_SPEC_INSTRUCTIONS = [
  '',
  '## UI Component Layout Specifications',
  'When the plan includes subtasks that create or significantly modify UI components (dialogs, modals, pages, panels, drawers, popovers, sidebars), each such subtask MUST specify these layout decisions so the implementor does not have to guess:',
  '',
  '1. **Sizing constraints** — min/max width and height (e.g., "max-w-2xl, min-h-[200px], max-h-[80vh]").',
  '2. **Overflow/scroll behavior** — how the component handles content that exceeds its bounds (e.g., "body scrolls vertically, header and footer stay fixed").',
  '3. **Responsive behavior** — what happens at small viewport sizes (e.g., "goes full-width below sm breakpoint, converts to bottom sheet on mobile").',
  '4. **Variable-length content** — identify any content that can vary in length (lists, text fields, error messages, loaded data) and specify how each is handled: truncation with tooltip, scrollable region, expandable section, or pagination.',
  '',
  'This does NOT require wireframes — just explicit decisions about layout behavior embedded in the subtask description.',
  'Example: "Create TriggerPostMortemDialog — max-w-2xl, max-h-[80vh] with scrollable body. Bug list scrolls if >5 items. Free-text field grows to max 200px then scrolls internally. Full-width below sm breakpoint."',
].join('\n');

const VERIFICATION_GUIDELINES = [
  '',
  '## Assumption Verification',
  'You have restricted write access to `tmp/` (relative to your working directory) so you can verify HIGH-risk assumptions during planning.',
  '',
  '**When to verify:** Only for HIGH-risk assumptions that would fundamentally change the plan if wrong (e.g., SDK behavior, API contracts, runtime behavior).',
  '**Do NOT verify:** Low/medium-risk assumptions, things you can confirm by reading source code, or well-documented behavior.',
  '',
  '**How to verify:**',
  '1. Write a script to `tmp/verify-<name>.ts` (or `.js`).',
  '2. Execute with `npx tsx tmp/verify-<name>.ts` or `node tmp/verify-<name>.js`.',
  '3. Read the output to confirm or refute the assumption.',
  '4. Delete the script: `rm tmp/verify-<name>.ts`.',
  '',
  '**Rules:**',
  '- ONLY write files to `tmp/` — writes anywhere else will be blocked.',
  '- You cannot use Edit, MultiEdit, or NotebookEdit tools — only Write (to `tmp/`) and Bash.',
  '- Keep verification scripts simple and fast (under 60 seconds).',
  '- Never modify existing source files — you are still in planning mode.',
  '- If a write fails or verification is impractical, skip it and document the assumption as UNVERIFIED.',
  '- After verification, report results in the `assumptions` field of your output.',
  '- Create `tmp/` directory first with `mkdir -p tmp/` if it does not exist.',
].join('\n');

const APPROACH_SUGGESTION_INSTRUCTIONS = [
  '',
  '## Plan Approach Suggestions',
  'After exploring the codebase and before producing a full plan, evaluate whether there are **meaningfully different implementation approaches** at different levels of effort and scope.',
  '',
  '**When to suggest approaches:** If the simple/minimal approach has notable tradeoffs — such as duplicating existing data, adding tech debt, bypassing existing patterns, or creating maintenance burden — you MUST present 2-3 approach options to the user before producing the full plan.',
  '',
  '**When to skip and plan directly:** If there is one clear good approach that is both simple and architecturally sound (no meaningful tradeoffs), skip approach suggestions and produce the full plan directly.',
  '',
  '**How to identify tradeoffs — ask yourself these questions during exploration:**',
  '- Does the data I need already exist elsewhere in the codebase? Would my approach duplicate it?',
  '- When this feature changes in the future (e.g., a new page is added, a new field is introduced), how many files need updating with my approach?',
  '- Am I introducing a pattern that conflicts with how similar things are done elsewhere in the codebase?',
  '- Is there existing duplication that this task could consolidate, or would my approach make worse?',
  '',
  '**Approach tiers:**',
  'Options should be differentiated by **effort size and plan complexity** so the user can choose how much scope to take on. Use these tiers:',
  '- **S (Small)** — Minimal, get-it-done approach. Completes the task with the fewest changes. May leave tech debt or not address underlying issues.',
  '- **M (Medium)** — Balanced approach. Addresses the task with reasonable architecture improvements. Good tradeoff between effort and code quality.',
  '- **L (Large)** — Comprehensive approach. Full refactor or consolidation that produces the best long-term architecture.',
  '',
  'Not all tiers are always needed. Use 2 options (S/L) when there is no meaningful middle ground, or 3 (S/M/L) when a balanced option exists. The goal is to let the user choose the direction based on clear tradeoffs between effort and architecture quality.',
  '',
  '**How to present approaches:**',
  'Use `outcome: "needs_info"` with a single question containing 2-3 options. Each option MUST include:',
  '- **label**: Start with the tier size, e.g. "S — Minimal: [what it does]", "M — Balanced: [what it does]", "L — Full refactor: [what it does]"',
  '- **description**: Use markdown with these sections:',
  '  - **Effort:** size estimate (XS/SM/MD/LG/XL) and file count',
  '  - **Approach:** 1-2 sentences describing what this option does',
  '  - **Concerns & tradeoffs:** What this option does NOT address, what tech debt it creates or leaves in place, what maintenance implications it has',
  '- Mark the approach you recommend with `recommended: true`',
  '',
  'Example option description (markdown):',
  '```',
  '**Effort:** SM (1 file)\\n\\n**Approach:** Add a static `PAGES` array directly in SearchDialog.tsx with all page definitions.\\n\\n**Concerns & tradeoffs:** Page definitions already exist in Sidebar, TabsContext, and TopMenu. This adds a 4th copy — future page additions require updating 4 files independently.',
  '```',
  '',
  'The question context should briefly explain what you found during exploration that makes the tradeoff meaningful (e.g., "Page definitions are currently duplicated across 3 files with no shared source of truth.").',
  '',
  'After the user selects an approach, you will resume and produce the full plan for their chosen option.',
].join('\n');

const EFFICIENCY_RULES = [
  '',
  '## Efficiency Rules',
  '- FIRST classify the task, THEN scope your exploration proportionally.',
  '- **Do NOT use the Agent/Task tool to spawn sub-agents.** Read files directly with Read, Grep, and Glob so their contents stay in your context. Sub-agents read files in isolation and force you to re-read everything.',
  '- Read each file AT MOST once. Do not re-read files you have already seen.',
  '- Do not explore files that are unlikely to appear in your change list or inform a key decision (e.g., skip store implementations, daemon routes, and config files for a pure UI task).',
  '- Avoid redundant exploration: if the task description already describes a file\'s role, do not re-read it to confirm what was stated.',
  '- **Turn budget:** Reserve your last 5-10 turns for producing the plan output. The plan is the deliverable — if you have explored enough to form a reasonable plan, stop exploring and write it. An imperfect plan produced on time is better than no plan at all.',
].join('\n');

export class PlannerPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'planner';

  protected isReadOnly(): boolean {
    return false;
  }

  protected getDisallowedTools(): string[] {
    return ['Edit', 'MultiEdit', 'NotebookEdit'];
  }

  protected getCleanupPaths(): string[] {
    return ['tmp'];
  }

  protected getExcludedFeedbackTypes(): string[] {
    return ['plan_feedback'];
  }

  protected getMaxTurns(): number {
    return 50;
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
          plan: { type: 'string', description: 'The full implementation plan as markdown' },
          planSummary: { type: 'string', description: 'A short 2-3 sentence summary of the plan for display in task context' },
          subtasks: {
            type: 'array',
            items: { type: 'string' },
            description: 'Concrete implementation steps that break down the plan. Use this for single-phase tasks (most tasks).',
          },
          phases: {
            type: 'array',
            description: 'Optional: For large tasks that should be implemented in multiple sequential phases, each with its own PR. Only use when the task is genuinely large enough to warrant separate PRs. Most tasks should use flat subtasks instead.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Phase name, e.g. "Phase 1: Data Model & Migration"' },
                subtasks: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Subtasks belonging to this phase',
                },
              },
              required: ['name', 'subtasks'],
            },
          },
          assumptions: {
            type: 'array',
            description: 'Technical assumptions the plan depends on. High-risk assumptions should be verified via scripts when possible.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Short identifier, e.g. "sdk-async-resume"' },
                description: { type: 'string', description: 'What is being assumed' },
                risk: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Impact if assumption is wrong' },
                verified: { type: 'boolean', description: 'Whether a verification script was run' },
                result: { type: 'string', enum: ['pass', 'fail'], description: 'Verification outcome (only if verified)' },
                evidence: { type: 'string', description: 'Script output or reasoning supporting the assumption' },
              },
              required: ['id', 'description', 'risk', 'verified'],
            },
          },
          ...getTaskEstimationFields(),
          ...getInteractiveFields(),
        },
        required: ['plan', 'planSummary', 'subtasks'],
      },
    };
  }

  buildPrompt(context: AgentContext): string {
    const { task, mode, revisionReason } = context;
    const desc = task.description ? ` ${task.description}` : '';

    let prompt: string;

    if (mode === 'revision' && revisionReason === 'changes_requested') {
      prompt = this.buildRevisionPrompt(context, task.title, desc, task.plan);
    } else if (mode === 'revision' && revisionReason === 'info_provided') {
      prompt = this.buildResumePrompt(context, task.title, desc);
    } else {
      prompt = this.buildNewPlanPrompt(context, task.title, desc);
    }

    prompt += PLAN_HEADER_FORMAT;
    prompt += VERIFICATION_GUIDELINES;
    prompt += getTaskEstimationInstructions();
    prompt += getInteractiveInstructions(this.type);

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  private buildNewPlanPrompt(context: AgentContext, title: string, desc: string): string {
    const lines = [
      `You are a senior software engineer. Create an implementation plan for the task below.`,
      ``,
      `**Task:** ${title}.${desc}`,
      ``,
      `## Planning Strategy`,
      ``,
      `Before exploring any code, read the task description above and classify it:`,
      ``,
      `**PRE-DESIGNED** — The description includes specific files to modify, data flows, and/or edge cases.`,
      `→ Do NOT explore from scratch. Make targeted file reads to verify key assumptions, then produce the plan based on the provided design. Most pre-designed tasks need only 5-10 file reads.`,
      ``,
      `**OPEN-ENDED** — The description is a goal without implementation details.`,
      `→ Explore relevant source files to understand current state and patterns. For small/medium tasks, focus on the 5-15 most relevant files. For large cross-cutting tasks, explore as many files as needed to produce a sound plan — but always prioritize files you expect to modify over tangential context.`,
      EFFICIENCY_RULES,
      APPROACH_SUGGESTION_INSTRUCTIONS,
      ``,
      `## Plan Requirements`,
      ``,
      `Produce a plan covering:`,
      `1. **Current state** — what exists today and what needs to change.`,
      `2. **Approach** — high-level strategy, key decisions, and alternatives considered.`,
      `3. **Files to modify** — each file with a short description of the change.`,
      `4. **Edge cases & risks** — detailed edge cases and minor risks, and whether each requires a code change (if so, include the file above). Major risks that could derail the approach should already be listed in the plan header.`,
      `5. **Assumptions** — mark each VERIFIED (cite file:line) or UNVERIFIED (implementor will verify).`,
      `6. **Subtasks** — 3-8 concrete, independently testable steps ordered by dependency.`,
      MULTI_PHASE_INSTRUCTIONS,
      UI_COMPONENT_SPEC_INSTRUCTIONS,
    ];
    lines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Admin Feedback'));
    return lines.join('\n');
  }

  private buildRevisionPrompt(context: AgentContext, title: string, desc: string, plan: string | null | undefined): string {
    const lines: string[] = [];
    if (context.sessionId) {
      lines.push(
        `Revise the plan based on the feedback below.`,
        ``,
        `Task: ${title}.${desc}`,
      );
    } else {
      lines.push(
        `Revise the plan based on admin feedback.`,
        ``,
        `Task: ${title}.${desc}`,
      );
      if (plan) {
        lines.push('', '## Current Plan', plan);
      }
    }
    lines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Admin Feedback'));
    lines.push(
      '',
      '## Revision Guidelines',
      '- Address every piece of feedback — do not skip or partially address any comment.',
      '- If feedback is ambiguous, interpret it reasonably and note your interpretation.',
      '- Keep parts of the plan that were not criticized — only revise what the feedback targets.',
      '- If the revision changes which files are modified or the core technical approach, re-read those files to verify your new approach works.',
      '',
      '## Output Requirements',
      '- The `plan` field must be a CLEAN, standalone plan — as if written from scratch.',
      '  - No "(Revised)" in the title. No "Changes from Initial Plan" or revision commentary.',
      '  - The plan should read as a fresh, authoritative document.',
      '- The `planSummary` field is where you describe what changed and how you addressed the feedback.',
    );
    return lines.join('\n');
  }

  private buildResumePrompt(context: AgentContext, title: string, desc: string): string {
    const lines = context.sessionId
      ? [
          `Continue creating the plan using the user's decisions below.`,
          ``,
          `Task: ${title}.${desc}`,
        ]
      : [
          `Continue creating the implementation plan using the user's decisions below.`,
          ``,
          `Task: ${title}.${desc}`,
        ];
    lines.push(...formatFeedbackForPrompt(context.taskContext, ['plan_feedback'], 'Admin Feedback'));
    lines.push(
      '',
      '## Instructions',
      '1. Review the user\'s answers to your questions above.',
      '2. Use their decisions to produce a complete implementation plan.',
      '3. If files are already named in the task or your prior exploration, do not re-explore them.',
      '4. Produce 3-8 concrete, independently testable subtasks ordered by dependency.',
      '5. Mark assumptions as VERIFIED (cite file:line) or UNVERIFIED.',
    );
    return lines.join('\n');
  }

  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return 'plan_complete';
  }
}
