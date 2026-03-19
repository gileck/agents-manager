import { resolve } from 'path';
import type { AgentContext, AgentConfig, AgentRunResult, TaskContextEntry } from '../../shared/types';
import { FEEDBACK_ENTRY_TYPES } from '../../shared/types';
import type { AgentLibResult } from '../interfaces/agent-lib';
import { PromptRenderer } from '../services/prompt-renderer';

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

  buildExecutionConfig(context: AgentContext, config: AgentConfig): AgentExecutionConfig {
    let prompt: string;
    if (context.modeConfig?.promptTemplate) {
      const renderer = new PromptRenderer();
      prompt = renderer.render(context.modeConfig.promptTemplate, context);
    } else {
      prompt = context.resolvedPrompt ?? this.buildPrompt(context);
      if (context.skills?.length) {
        const skillsList = context.skills.map(s => `- /${s}`).join('\n');
        prompt += `\n\n## Available Skills\nYou have access to the following skills. Use the Skill tool to invoke them:\n${skillsList}`;
      }
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

    const disallowedTools = this.getDisallowedTools();
    const cleanupPaths = this.getCleanupPaths();

    return {
      prompt,
      maxTurns: this.getMaxTurns(context),
      timeoutMs: this.getTimeout(context, config),
      outputFormat: this.getOutputFormat(context),
      readOnly: this.isReadOnly(context),
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
    if (payload) result.payload = payload;
    return result;
  }
}
