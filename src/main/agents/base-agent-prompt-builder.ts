import type { AgentContext, AgentConfig, AgentRunResult } from '../../shared/types';
import type { AgentLibResult } from '../interfaces/agent-lib';
import { PromptRenderer } from '../services/prompt-renderer';

export interface AgentExecutionConfig {
  prompt: string;
  maxTurns: number;
  timeoutMs: number;
  outputFormat?: object;
  readOnly: boolean;
}

export abstract class BaseAgentPromptBuilder {
  abstract readonly type: string;

  abstract buildPrompt(context: AgentContext): string;
  abstract inferOutcome(mode: string, exitCode: number, output: string): string;

  protected getMaxTurns(_context: AgentContext): number {
    return 100;
  }

  protected getOutputFormat(_context: AgentContext): object | undefined {
    return undefined;
  }

  protected getTimeout(context: AgentContext, config: AgentConfig): number {
    return config.timeout || 10 * 60 * 1000;
  }

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
      const block = context.taskContext.map(e => {
        const ts = new Date(e.createdAt).toISOString();
        return `### [${e.source}] ${e.entryType} (${ts})\n${e.summary}`;
      }).join('\n\n');
      prompt = `## Task Context\n\n${block}\n\n---\n\n${prompt}`;
    }

    if (!context.workdir) {
      throw new Error(`AgentContext.workdir is required but was not set for task "${context.task.id}"`);
    }

    /**
     * Determines whether the agent should run in read-only mode (no file writes).
     *
     * Read-only modes are those that only analyze code without producing changes:
     * plan, plan_revision, plan_resume, investigate, investigate_resume, and review.
     *
     * Note: technical_design* modes are intentionally excluded because the agent
     * may need to inspect and create design artifacts or scaffolding files in the
     * worktree, even though the primary output is a design document.
     */
    const isReadOnlyMode = context.mode === 'plan' || context.mode === 'plan_revision' || context.mode === 'plan_resume'
      || context.mode === 'investigate' || context.mode === 'investigate_resume'
      || context.mode === 'review';

    return {
      prompt,
      maxTurns: this.getMaxTurns(context),
      timeoutMs: this.getTimeout(context, config),
      outputFormat: this.getOutputFormat(context),
      readOnly: isReadOnlyMode,
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
      structuredOutput: libResult.structuredOutput,
      prompt,
    };
    if (payload) result.payload = payload;
    return result;
  }
}
