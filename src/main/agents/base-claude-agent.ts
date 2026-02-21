import type { AgentContext, AgentConfig, AgentRunResult, AgentChatMessage } from '../../shared/types';
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
  message: { content: SdkContentBlock[]; usage?: { input_tokens: number; output_tokens: number } };
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

  /** Accumulated running totals updated from each assistant message's usage. */
  accumulatedInputTokens = 0;
  accumulatedOutputTokens = 0;

  /** Number of SDK messages processed so far. */
  lastMessageCount = 0;

  /** The timeout and maxTurns used for the current/last run. */
  lastTimeout: number | undefined;
  lastMaxTurns: number | undefined;

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

  async execute(context: AgentContext, config: AgentConfig, onOutput?: (chunk: string) => void, onLog?: (message: string, data?: Record<string, unknown>) => void, onPromptBuilt?: (prompt: string) => void, onMessage?: (msg: AgentChatMessage) => void): Promise<AgentRunResult> {
    this.lastCostInputTokens = undefined;
    this.lastCostOutputTokens = undefined;
    this.accumulatedInputTokens = 0;
    this.accumulatedOutputTokens = 0;
    this.lastMessageCount = 0;

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
    const maxTurns = this.getMaxTurns(context);
    this.lastTimeout = timeout;
    this.lastMaxTurns = maxTurns;

    const abortController = new AbortController();
    const runId = context.task.id;
    this.runningAbortControllers.set(runId, abortController);

    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abortController.abort(); }, timeout);

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

    // Set up sandbox guard — restrict file access to worktree
    const isReadOnlyMode = context.mode === 'plan' || context.mode === 'plan_revision' || context.mode === 'plan_resume'
      || context.mode === 'investigate' || context.mode === 'investigate_resume';
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

    const startTime = Date.now();

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
        this.lastMessageCount = messageCount;
        if (messageCount % 25 === 0) {
          log(`SDK message loop heartbeat: ${messageCount} messages processed`);
        }

        if (message.type === 'assistant') {
          const assistantMsg = message as SdkAssistantMessage;
          // Accumulate per-message usage if available
          if (assistantMsg.message.usage) {
            this.accumulatedInputTokens += assistantMsg.message.usage.input_tokens;
            this.accumulatedOutputTokens += assistantMsg.message.usage.output_tokens;
            // Emit live usage so the renderer sidebar updates during the run
            onMessage?.({ type: 'usage', inputTokens: this.accumulatedInputTokens, outputTokens: this.accumulatedOutputTokens, timestamp: Date.now() });
          }
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              emit(block.text + '\n');
              onMessage?.({ type: 'assistant_text', text: block.text, timestamp: Date.now() });
            } else if (block.type === 'tool_use') {
              const input = JSON.stringify(block.input ?? {});
              emit(`\n> Tool: ${block.name}\n> Input: ${input.slice(0, 2000)}${input.length > 2000 ? '...' : ''}\n`);
              onMessage?.({ type: 'tool_use', toolName: block.name, toolId: (block as unknown as { id?: string }).id, input: input.slice(0, 2000), timestamp: Date.now() });
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
          if (costInputTokens != null || costOutputTokens != null) {
            onMessage?.({ type: 'usage', inputTokens: costInputTokens ?? 0, outputTokens: costOutputTokens ?? 0, timestamp: Date.now() });
          }
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
            // Emit tool_result for tool-type messages
            if (message.type === 'tool') {
              onMessage?.({ type: 'tool_result', toolId: (otherMsg as unknown as { tool_use_id?: string }).tool_use_id, result: otherMsg.result, timestamp: Date.now() });
            }
          }
        }
      }
      log(`SDK message loop completed: ${messageCount} messages, hasStructuredOutput=${!!structuredOutput}, isError=${isError}`);
    } catch (err) {
      isError = true;
      // The SDK's AbortError class is minified so err.name !== 'AbortError'.
      // Use the timedOut flag (set by our setTimeout callback) and the abort
      // signal to distinguish timeout, user-abort, and execution errors.
      const sdkError = err instanceof Error ? err.message : String(err);
      errorMessage = sdkError;
      if (timedOut) {
        const elapsed = Date.now() - startTime;
        errorMessage = `Agent timed out after ${Math.round(elapsed / 1000)}s (timeout=${Math.round(timeout / 1000)}s, ${messageCount} messages processed)`;
        log(`${errorMessage} [sdk: ${sdkError}]`);
      } else if (abortController.signal.aborted) {
        const elapsed = Date.now() - startTime;
        errorMessage = `Agent aborted after ${Math.round(elapsed / 1000)}s (${messageCount} messages processed)`;
        log(`${errorMessage} [sdk: ${sdkError}]`);
      } else {
        log(`Agent execution error: ${errorMessage}`);
      }
    } finally {
      clearTimeout(timer);
      this.runningAbortControllers.delete(runId);
    }

    const elapsed = Date.now() - startTime;
    const exitCode = isError ? 1 : 0;
    let outcome = this.inferOutcome(context.mode, exitCode, resultText);

    // Allow agent to override outcome via structured output
    let payload: Record<string, unknown> | undefined;
    if (exitCode === 0 && structuredOutput?.outcome === 'needs_info' && Array.isArray(structuredOutput?.questions) && structuredOutput.questions.length > 0) {
      outcome = 'needs_info';
      payload = { questions: structuredOutput.questions };
    }

    log(`Agent returning: exitCode=${exitCode}, outcome=${outcome}, outputLength=${resultText.length}, hasStructuredOutput=${!!structuredOutput}, duration=${Math.round(elapsed / 1000)}s, messages=${messageCount}, error=${errorMessage ?? 'none'}`);

    const output = resultText || errorMessage || '';
    const result = this.buildResult(exitCode, output, outcome, isError ? errorMessage : undefined, costInputTokens, costOutputTokens, structuredOutput, prompt);
    if (payload) result.payload = payload;
    return result;
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
