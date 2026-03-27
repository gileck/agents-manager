import { resolve } from 'path';
import type { AgentContext, AgentConfig, AgentRunResult, AgentFileConfig, TaskContextEntry } from '../../shared/types';
import { FEEDBACK_ENTRY_TYPES } from '../../shared/types';
import type { AgentLibResult } from '../interfaces/agent-lib';
import { PromptRenderer } from '../services/prompt-renderer';
import { buildGenericDocsSection } from './doc-injection';

/** Format a single review comment — supports both structured objects and legacy strings. */
function formatReviewComment(c: unknown): string {
  if (typeof c === 'object' && c !== null && 'file' in c && 'severity' in c && 'issue' in c) {
    const comment = c as { file: string; severity: string; issue: string; suggestion?: string };
    let line = `- **[${comment.severity}]** \`${comment.file}\`: ${comment.issue}`;
    if (comment.suggestion) {
      line += ` → ${comment.suggestion}`;
    }
    return line;
  }
  return `- ${String(c)}`;
}

/** Format a context entry for inclusion in the prompt, including reviewer comments when present. */
function formatContextEntry(e: TaskContextEntry): string {
  const ts = new Date(e.createdAt).toISOString();
  let text = `### [${e.source}] ${e.entryType} (${ts})\n${e.summary}`;
  const comments = e.data?.comments;
  if (Array.isArray(comments) && comments.length > 0) {
    text += '\n\n**Review Comments:**';
    for (const c of comments) {
      text += `\n${formatReviewComment(c)}`;
    }
  }
  return text;
}

export interface AgentExecutionConfig {
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  outputFormat?: object;
  readOnly: boolean;
  /** Tool names to disallow regardless of readOnly flag (e.g., ['Edit', 'MultiEdit', 'NotebookEdit']). */
  disallowedTools?: string[];
  /** Paths relative to workdir that the agent may write to and that should be cleaned up after execution. */
  cleanupPaths?: string[];
}

export abstract class BaseAgentPromptBuilder {
  abstract readonly type: string;

  abstract buildPrompt(context: AgentContext): string;
  abstract inferOutcome(mode: string, exitCode: number, output: string): string;

  /**
   * Format the task description as a suffix string.
   * Returns ` <description>` (with leading space) if description exists, empty string otherwise.
   */
  protected formatTaskDescription(task: { description?: string | null }): string {
    return task.description ? ` ${task.description}` : '';
  }

  /**
   * Append validation error instructions to a prompt if validation errors are present.
   * Returns the prompt unchanged if there are no validation errors.
   * @param commitSuffix - additional instruction appended after the errors (e.g. ', then stage and commit')
   */
  protected appendValidationErrors(prompt: string, context: AgentContext, commitSuffix = ''): string {
    if (!context.validationErrors) return prompt;
    return prompt + `\n\nThe previous attempt produced validation errors. Fix these issues${commitSuffix}:\n\n${context.validationErrors}`;
  }

  protected isReadOnly(_context: AgentContext): boolean {
    return false;
  }

  protected getMaxTurns(_context: AgentContext): number {
    return 100;
  }

  protected getOutputFormat(_context: AgentContext): object | undefined {
    return undefined;
  }

  protected getTimeout(context: AgentContext, config: AgentConfig): number {
    return config.timeout || 10 * 60 * 1000;
  }

  /** Tool names to disallow regardless of readOnly flag. Override in subclasses. */
  protected getDisallowedTools(): string[] | undefined { return undefined; }

  /** Paths relative to workdir that the agent may write to; cleaned up after execution. */
  protected getCleanupPaths(): string[] { return []; }

  /** Feedback types the subclass handles in its own prompt (excluded from base Unaddressed Feedback). */
  protected getExcludedFeedbackTypes(): string[] { return []; }

  /**
   * Build a short continuation prompt for revision-mode session resumes.
   *
   * When a session is resumed for a revision (e.g., plan feedback), the SDK loads
   * the prior conversation. Passing the full system prompt is ignored because the
   * agent already has the context. Instead, we send a short message that tells the
   * agent about the new feedback and what to do.
   *
   * Returns null if no continuation prompt is needed (falls back to full prompt).
   * Subclasses can override for agent-type-specific revision instructions.
   */
  buildContinuationPrompt(context: AgentContext): string | null {
    if (context.mode !== 'revision' || !context.revisionReason) return null;

    // Extract unaddressed feedback entries from task context
    const feedbackTypeSet = new Set<string>(FEEDBACK_ENTRY_TYPES);
    const allFeedback = (context.taskContext ?? []).filter(
      e => feedbackTypeSet.has(e.entryType) && !e.addressed,
    );

    // If there's no feedback and no custom prompt, nothing to inject
    if (allFeedback.length === 0 && !context.customPrompt?.trim()) return null;

    const lines: string[] = [];

    // Opening instruction based on revision reason
    switch (context.revisionReason) {
      case 'changes_requested':
        lines.push('The user has provided new feedback on your work. You must revise your output to address all of the feedback below.');
        break;
      case 'info_provided':
        lines.push('The user has provided answers to your questions. Continue where you left off and use their decisions to complete the task.');
        break;
      case 'merge_failed':
        lines.push('A merge/rebase conflict was detected. Resolve the conflicts and ensure the branch is clean.');
        break;
      case 'uncommitted_changes':
        lines.push('There are uncommitted changes from a prior run. Stage and commit them to complete the task.');
        break;
      default:
        lines.push(`You are being asked to revise your work (reason: ${context.revisionReason}).`);
        break;
    }

    // Include feedback content
    if (allFeedback.length > 0) {
      lines.push('', '## Feedback to Address');
      for (const entry of allFeedback) {
        lines.push('', formatContextEntry(entry));
      }
    }

    // Include custom prompt if provided (e.g., from message queue)
    if (context.customPrompt?.trim()) {
      lines.push('', '## Additional Instructions', context.customPrompt.trim());
    }

    if (context.revisionReason === 'changes_requested') {
      lines.push('', 'Address every piece of feedback. Do not skip or partially address any comment.');
    }

    return lines.join('\n');
  }

  buildExecutionConfig(
    context: AgentContext,
    config: AgentConfig,
    fileConfig?: AgentFileConfig,
    onLog?: (message: string, data?: Record<string, unknown>) => void,
  ): AgentExecutionConfig {
    const log = onLog ?? (() => {});

    // --- Prompt resolution: file > code ---
    let prompt: string;
    let promptSource: 'file' | 'default' = 'default';
    if (fileConfig?.prompt) {
      // File-based prompt — render through PromptRenderer for variable substitution
      try {
        const renderer = new PromptRenderer();
        prompt = renderer.render(fileConfig.prompt, context);
        promptSource = 'file';
        log(`Using file-based prompt from ${fileConfig.promptPath}`, { agentType: this.type, source: 'file' });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Failed to render file-based prompt from ${fileConfig.promptPath}: ${message}, falling back to hardcoded default`, {
          agentType: this.type, error: message, path: fileConfig.promptPath,
        });
        prompt = context.resolvedPrompt ?? this.buildPrompt(context);
      }
    } else {
      prompt = context.resolvedPrompt ?? this.buildPrompt(context);
    }

    // Append skills section (for both file-based and code-based prompts)
    if (context.skills?.length) {
      const skillsList = context.skills.map(s => `- /${s}`).join('\n');
      prompt += `\n\n## Available Skills\nYou have access to the following skills. Use the Skill tool to invoke them:\n${skillsList}`;
    }
    if (context.taskContext?.length) {
      const feedbackTypeSet = new Set<string>(FEEDBACK_ENTRY_TYPES);
      const feedbackEntries = context.taskContext.filter(e => feedbackTypeSet.has(e.entryType));
      const workEntries = context.taskContext.filter(e => !feedbackTypeSet.has(e.entryType));

      const sections: string[] = [];

      // Unaddressed feedback — shown prominently (excluding types handled by subclass)
      const excludedTypes = new Set(this.getExcludedFeedbackTypes());
      const unaddressed = feedbackEntries.filter(e => !e.addressed && !excludedTypes.has(e.entryType));
      if (unaddressed.length > 0) {
        const block = unaddressed.map(e => formatContextEntry(e)).join('\n\n');
        sections.push(`## Unaddressed Feedback\n\n${block}`);
      }

      // Work product context (agent summaries, user inputs, etc.)
      if (workEntries.length > 0) {
        const block = workEntries.map(e => formatContextEntry(e)).join('\n\n');
        sections.push(`## Task Context\n\n${block}`);
      }

      // Addressed feedback — collapsed to count
      const addressedCount = feedbackEntries.filter(e => e.addressed).length;
      if (addressedCount > 0) {
        sections.push(`Note: ${addressedCount} previous feedback comment${addressedCount > 1 ? 's were' : ' was'} already addressed.`);
      }

      if (sections.length > 0) {
        prompt = `${sections.join('\n\n')}\n\n---\n\n${prompt}`;
      }
    }

    // --- Generic docs injection: show all task docs as summaries ---
    // NOTE: Some agents (implementor, designer, ux-designer) also embed specific docs
    // in full via their own buildPrompt(). This generic section is intentionally additive —
    // it ensures every agent (especially file-based prompt templates) gets at least a
    // summary of all prior work products, even if some appear twice in different forms.
    const docsSection = buildGenericDocsSection(context.docs);
    if (docsSection) {
      prompt = `${docsSection}\n\n---\n\n${prompt}`;
    }

    if (!context.workdir) {
      throw new Error(`AgentContext.workdir is required but was not set for task "${context.task.id}"`);
    }

    // Worktree safety: when the agent is working in a worktree (workdir != project path),
    // prepend aggressive instructions to prevent the agent from escaping the worktree.
    const projectPath = context.project?.path;
    if (projectPath && resolve(context.workdir) !== resolve(projectPath)) {
      const worktreeGuard = [
        `## CRITICAL: WORKTREE SAFETY — READ THIS FIRST`,
        ``,
        `You are working in an isolated git worktree, NOT the main repository.`,
        ``,
        `YOUR WORKING DIRECTORY: \`${context.workdir}\``,
        `MAIN REPOSITORY (FORBIDDEN): \`${projectPath}\``,
        ``,
        `MANDATORY RULES:`,
        `- NEVER use absolute paths starting with \`${projectPath}/\` for ANY tool call (Read, Write, Edit, Bash, Glob, Grep, etc.)`,
        `- NEVER \`cd\` to \`${projectPath}\` or any directory outside your worktree`,
        `- NEVER run find, git, or any command targeting \`${projectPath}\``,
        `- Use RELATIVE paths (e.g., \`src/...\`) — they resolve within your worktree automatically`,
        `- If a plan or design references absolute paths from the main repo, translate them to relative paths first`,
        `- All git operations (commit, rebase, push) must happen in your worktree, not the main repo`,
        ``,
        `Any operation touching the main repository instead of the worktree is a CRITICAL BUG.`,
      ].join('\n');
      prompt = worktreeGuard + '\n\n---\n\n' + prompt;
    }

    const cleanupPaths = this.getCleanupPaths();

    // --- Config field resolution: file config (if present) > builder defaults ---
    const fc = fileConfig?.config;
    const maxTurns = fc?.maxTurns ?? this.getMaxTurns(context);
    const timeoutMs = fc?.timeout ?? this.getTimeout(context, config);
    const readOnly = fc?.readOnly ?? this.isReadOnly(context);
    const outputFormat = fc?.outputFormat ?? this.getOutputFormat(context);
    const disallowedTools = fc?.disallowedTools ?? this.getDisallowedTools();

    // Log config merge with source attribution
    if (fc) {
      const fields = [
        `maxTurns=${maxTurns} (${fc.maxTurns !== undefined ? 'file' : 'default'})`,
        `timeout=${timeoutMs} (${fc.timeout !== undefined ? 'file' : 'default'})`,
        `readOnly=${readOnly} (${fc.readOnly !== undefined ? 'file' : 'default'})`,
      ];
      if (disallowedTools) fields.push(`disallowedTools=[${disallowedTools.join(',')}] (${fc.disallowedTools !== undefined ? 'file' : 'default'})`);
      if (outputFormat) fields.push(`outputFormat=present (${fc.outputFormat !== undefined ? 'file' : 'default'})`);
      log(`${this.type} config: ${fields.join(', ')}`, { agentType: this.type, promptSource });
    }

    return {
      prompt,
      maxTurns,
      timeoutMs,
      outputFormat,
      readOnly,
      ...(disallowedTools ? { disallowedTools } : {}),
      ...(cleanupPaths.length > 0 ? { cleanupPaths } : {}),
    };
  }

  buildResult(_context: AgentContext, libResult: AgentLibResult, outcome: string, prompt: string): AgentRunResult {
    let effectiveOutcome = outcome;
    let payload: Record<string, unknown> | undefined;

    // Allow agent to override outcome via structured output (needs_info)
    if (libResult.exitCode === 0
      && libResult.structuredOutput?.outcome === 'needs_info'
      && Array.isArray(libResult.structuredOutput?.questions)
      && (libResult.structuredOutput.questions as unknown[]).length > 0
    ) {
      effectiveOutcome = 'needs_info';
      payload = { questions: libResult.structuredOutput.questions };
    }

    const result: AgentRunResult = {
      exitCode: libResult.exitCode,
      output: libResult.output,
      outcome: effectiveOutcome,
      error: libResult.error,
      costInputTokens: libResult.costInputTokens,
      costOutputTokens: libResult.costOutputTokens,
      cacheReadInputTokens: libResult.cacheReadInputTokens,
      cacheCreationInputTokens: libResult.cacheCreationInputTokens,
      totalCostUsd: libResult.totalCostUsd,
      model: libResult.model,
      structuredOutput: libResult.structuredOutput,
      prompt,
      killReason: libResult.killReason,
      rawExitCode: libResult.rawExitCode,
    };
    result.payload = payload ?? libResult.structuredOutput;
    return result;
  }

  /**
   * Expose builder default config values for external tooling (e.g., `agents init` scaffolding).
   * Returns the execution config defaults as determined by the builder's protected methods.
   */
  getDefaultConfigValues(context: AgentContext, config: AgentConfig): {
    maxTurns: number;
    timeout: number;
    readOnly: boolean;
    disallowedTools?: string[];
    outputFormat?: object;
  } {
    return {
      maxTurns: this.getMaxTurns(context),
      timeout: this.getTimeout(context, config),
      readOnly: this.isReadOnly(context),
      disallowedTools: this.getDisallowedTools(),
      outputFormat: this.getOutputFormat(context),
    };
  }
}
