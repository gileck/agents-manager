import type { AgentContext, AgentConfig } from '../../shared/types';
import { BaseAgentPromptBuilder } from './base-agent-prompt-builder';
import { type ModePromptDef, modePrompts, getInteractiveInstructions } from './prompts';

/**
 * Prompt builder for the "claude-code" agent type.
 *
 * All mode-specific prompt logic lives in `./prompts/<domain>-prompt.ts`.
 * This class is a thin dispatcher that delegates to those modules.
 */
export class ImplementorPromptBuilder extends BaseAgentPromptBuilder {
  readonly type = 'claude-code';

  private getModePrompt(mode: string): ModePromptDef {
    const def = modePrompts[mode];
    if (!def) {
      throw new Error(`[ImplementorPromptBuilder] No prompt definition registered for mode "${mode}"`);
    }
    return def;
  }

  protected getMaxTurns(context: AgentContext): number {
    return this.getModePrompt(context.mode).config.maxTurns;
  }

  protected getTimeout(context: AgentContext, config: AgentConfig): number {
    if (config.timeout) return config.timeout;
    return this.getModePrompt(context.mode).config.timeoutMs;
  }

  protected getOutputFormat(context: AgentContext): object | undefined {
    return this.getModePrompt(context.mode).getOutputSchema();
  }

  buildPrompt(context: AgentContext): string {
    const { mode } = context;
    const modeDef = this.getModePrompt(mode);

    let prompt = modeDef.buildPrompt(context);

    // Modes with structured output get their summary via the schema.
    // For other modes, ask for a textual summary section.
    if (!modeDef.getOutputSchema()) {
      prompt += '\n\nWhen you are done, end your response with a "## Summary" section that briefly describes what you did.';
    }

    // Append interactive question instructions for modes that support it
    if (modeDef.config.interactive) {
      prompt += getInteractiveInstructions(mode);
    }

    if (context.validationErrors) {
      prompt += `\n\nThe previous attempt produced validation errors. Fix these issues, then stage and commit:\n\n${context.validationErrors}`;
    }

    return prompt;
  }

  inferOutcome(mode: string, exitCode: number, _output: string): string {
    if (exitCode !== 0) return 'failed';
    return this.getModePrompt(mode).successOutcome;
  }
}
