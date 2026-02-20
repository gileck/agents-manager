import type { AgentContext, AgentConfig, AgentRunResult } from '../../shared/types';
import type { IAgent } from '../interfaces/agent';
import { PromptRenderer } from '../services/prompt-renderer';
import { SandboxGuard } from '../services/sandbox-guard';

// Use Function constructor to preserve dynamic import() at runtime.
// TypeScript compiles `await import(...)` to `require()` under CommonJS,
// but the SDK is ESM-only (.mjs). This bypasses that transformation.
const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

interface SdkTextBlock { type: 'text'; text: string }
interface SdkToolUseBlock { type: 'tool_use'; name: string; input?: unknown }
type SdkContentBlock = SdkTextBlock | SdkToolUseBlock;

interface SdkAssistantMessage {
  type: 'assistant';
  message: { content: SdkContentBlock[] };
}
interface SdkResultMessage {
  type: 'result';
  subtype: string;
  errors?: string[];
  structured_output?: Record<string, unknown>;
  usage?: { input_tokens: number; output_tokens: number };
}
interface SdkOtherMessage {
  type: string;
  message?: { content?: SdkContentBlock[] };
  summary?: string;
  result?: string;
}
type SdkStreamMessage = SdkAssistantMessage | SdkResultMessage | SdkOtherMessage;

export abstract class BaseClaudeAgent implements IAgent {
  abstract readonly type: string;

  /** Partial cost data accessible even when execute() throws. */
  lastCostInputTokens: number | undefined;
  lastCostOutputTokens: number | undefined;

  private runningAbortControllers = new Map<string, AbortController>();

  abstract buildPrompt(context: AgentContext): string;
  abstract inferOutcome(mode: string, exitCode: number, output: string): string;

  /** Override in subclass to limit the number of SDK turns. */
  protected getMaxTurns(_context: AgentContext): number {
    return 100;
  }

  /** Override in subclass to request structured JSON output from the SDK. */
  protected getOutputFormat(_context: AgentContext): object | undefined {
    return undefined;
  }

  buildResult(exitCode: number, output: string, outcome: string, error?: string, costInputTokens?: number, costOutputTokens?: number, structuredOutput?: Record<string, unknown>, prompt?: string): AgentRunResult {
    return { exitCode, output, outcome, error, costInputTokens, costOutputTokens, structuredOutput, prompt };
  }

  protected getTimeout(context: AgentContext, config: AgentConfig): number {
    return config.timeout || 10 * 60 * 1000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const query = await this.loadQuery();
      return !!query;
    } catch {
      return false;
    }
  }

  async execute(context: AgentContext, config: AgentConfig, onOutput?: (chunk: string) => void, onLog?: (message: string, data?: Record<string, unknown>) => void, onPromptBuilt?: (prompt: string) => void): Promise<AgentRunResult> {
    this.lastCostInputTokens = undefined;
    this.lastCostOutputTokens = undefined;

    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);
    const query = await this.loadQuery();

    let prompt: string;
    if (context.modeConfig?.promptTemplate) {
      const renderer = new PromptRenderer();
      prompt = renderer.render(context.modeConfig.promptTemplate, context);
    } else {
      prompt = context.resolvedPrompt ?? this.buildPrompt(context);
      // Only append skills for non-template prompts (templates use {skillsSection})
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
    onPromptBuilt?.(prompt);
    if (!context.workdir) {
      throw new Error(`AgentContext.workdir is required but was not set for task "${context.task.id}"`);
    }
    const workdir = context.workdir;
    const timeout = this.getTimeout(context, config);

    const abortController = new AbortController();
    const runId = context.task.id;
    this.runningAbortControllers.set(runId, abortController);

    const timer = setTimeout(() => abortController.abort(), timeout);

    let resultText = '';
    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;
    let structuredOutput: Record<string, unknown> | undefined;
    let isError = false;
    let errorMessage: string | undefined;
    let messageCount = 0;

    const emit = (chunk: string) => {
      resultText += chunk;
      onOutput?.(chunk);
    };

    log(`Starting agent run: mode=${context.mode}, workdir=${workdir}, timeout=${timeout}ms, model=${config.model ?? 'default'}`);

    const outputFormat = this.getOutputFormat(context);
    const maxTurns = this.getMaxTurns(context);

    // Set up sandbox guard — restrict file access to worktree
    const isReadOnlyMode = context.mode === 'plan' || context.mode === 'plan_revision' || context.mode === 'investigate';
    const sandboxGuard = new SandboxGuard(
      [workdir],
      isReadOnlyMode && context.project?.path ? [context.project.path] : [],
    );

    log(`Entering SDK message loop`, {
      promptLength: prompt.length,
      model: config.model ?? 'default',
      maxTurns,
      hasOutputFormat: !!outputFormat,
    });

    try {
      for await (const message of query({
        prompt,
        options: {
          cwd: workdir,
          abortController,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          model: config.model,
          maxTurns,
          ...(outputFormat ? { outputFormat } : {}),
          hooks: {
            preToolUse: (toolName: string, toolInput: Record<string, unknown>) => {
              const result = sandboxGuard.evaluateToolCall(toolName, toolInput);
              if (!result.allow) {
                log(`Sandbox guard blocked ${toolName}: ${result.reason}`);
                return { decision: 'block', reason: result.reason };
              }
              return undefined;
            },
          },
        },
      }) as AsyncIterable<SdkStreamMessage>) {
        messageCount++;
        if (messageCount % 25 === 0) {
          log(`SDK message loop heartbeat: ${messageCount} messages processed`);
        }

        if (message.type === 'assistant') {
          const assistantMsg = message as SdkAssistantMessage;
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              emit(block.text + '\n');
            } else if (block.type === 'tool_use') {
              const input = JSON.stringify(block.input ?? {});
              emit(`\n> Tool: ${block.name}\n> Input: ${input.slice(0, 2000)}${input.length > 2000 ? '...' : ''}\n`);
            }
          }
        } else if (message.type === 'result') {
          const resultMsg = message as SdkResultMessage;
          if (resultMsg.subtype !== 'success') {
            isError = true;
            errorMessage = resultMsg.errors?.join('\n') || 'Agent execution failed';
          }
          if (resultMsg.structured_output) {
            structuredOutput = resultMsg.structured_output;
          }
          costInputTokens = resultMsg.usage?.input_tokens;
          costOutputTokens = resultMsg.usage?.output_tokens;
          this.lastCostInputTokens = costInputTokens;
          this.lastCostOutputTokens = costOutputTokens;
        } else {
          const otherMsg = message as SdkOtherMessage;
          if (otherMsg.message?.content) {
            for (const block of otherMsg.message.content) {
              if (block.type === 'text') {
                emit(`[${message.type}] ${block.text}\n`);
              }
            }
          } else if (typeof otherMsg.summary === 'string') {
            emit(`[${message.type}] ${otherMsg.summary}\n`);
          } else if (typeof otherMsg.result === 'string') {
            emit(`[${message.type}] ${otherMsg.result}\n`);
          }
        }
      }
      log(`SDK message loop completed: ${messageCount} messages, hasStructuredOutput=${!!structuredOutput}, isError=${isError}`);
    } catch (err) {
      isError = true;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      errorMessage = err instanceof Error ? err.message : String(err);
      if (isAbort) {
        log(`Agent timed out after ${timeout}ms (${messageCount} messages processed)`);
      } else {
        log(`Agent execution error: ${errorMessage}`);
      }
    } finally {
      clearTimeout(timer);
      this.runningAbortControllers.delete(runId);
    }

    const exitCode = isError ? 1 : 0;
    const outcome = this.inferOutcome(context.mode, exitCode, resultText);

    log(`Agent returning: exitCode=${exitCode}, outcome=${outcome}, outputLength=${resultText.length}, hasStructuredOutput=${!!structuredOutput}`);

    const output = resultText || errorMessage || '';
    return this.buildResult(exitCode, output, outcome, isError ? errorMessage : undefined, costInputTokens, costOutputTokens, structuredOutput, prompt);
  }

  async stop(runId: string): Promise<void> {
    const controller = this.runningAbortControllers.get(runId);
    if (!controller) return;

    controller.abort();
    this.runningAbortControllers.delete(runId);
  }

  protected async loadQuery(): Promise<(opts: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    return mod.query as (opts: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>;
  }
}
