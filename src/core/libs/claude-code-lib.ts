import type { AgentChatMessage } from '../../shared/types';
import type { IAgentLib, AgentLibRunOptions, AgentLibCallbacks, AgentLibResult, AgentLibTelemetry, AgentLibModelOption } from '../interfaces/agent-lib';
import { SandboxGuard } from '../services/sandbox-guard';
import { getAppLogger } from '../services/app-logger';

// Use Function constructor to preserve dynamic import() at runtime.
// TypeScript compiles `await import(...)` to `require()` under CommonJS,
// but the SDK is ESM-only (.mjs). This bypasses that transformation.
const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

interface SdkTextBlock { type: 'text'; text: string }
interface SdkThinkingBlock { type: 'thinking'; thinking: string }
interface SdkToolUseBlock { type: 'tool_use'; name: string; input?: unknown }
type SdkContentBlock = SdkTextBlock | SdkThinkingBlock | SdkToolUseBlock;

interface SdkAssistantMessage {
  type: 'assistant';
  message: { id?: string; content: SdkContentBlock[]; usage?: { input_tokens: number; output_tokens: number } };
}
interface SdkResultMessage {
  type: 'result';
  subtype: string;
  errors?: string[];
  structured_output?: Record<string, unknown>;
  usage?: { input_tokens: number; output_tokens: number };
  total_cost_usd?: number;
  modelUsage?: Record<string, { input_tokens: number; output_tokens: number }>;
}
interface SdkOtherMessage {
  type: string;
  message?: { content?: SdkContentBlock[] };
  summary?: string;
  result?: string;
}
type SdkStreamMessage = SdkAssistantMessage | SdkResultMessage | SdkOtherMessage;

interface RunState {
  abortController: AbortController;
  accumulatedInputTokens: number;
  accumulatedOutputTokens: number;
  seenMessageIds: Set<string>;
  messageCount: number;
  timeout: number;
  maxTurns: number;
  /** Set by stop() before aborting so the catch block can distinguish user-stop from timeout. */
  stoppedReason?: string;
}

export class ClaudeCodeLib implements IAgentLib {
  readonly name = 'claude-code';

  private runningStates = new Map<string, RunState>();

  getDefaultModel(): string { return 'claude-opus-4-6'; }

  getSupportedModels(): AgentLibModelOption[] {
    return [
      { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const query = await this.loadQuery();
      return !!query;
    } catch {
      return false;
    }
  }

  getTelemetry(runId: string): AgentLibTelemetry | null {
    const state = this.runningStates.get(runId);
    if (!state) return null;
    return {
      accumulatedInputTokens: state.accumulatedInputTokens,
      accumulatedOutputTokens: state.accumulatedOutputTokens,
      messageCount: state.messageCount,
      timeout: state.timeout,
      maxTurns: state.maxTurns,
    };
  }

  async execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult> {
    const { onOutput, onLog, onMessage } = callbacks;
    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);

    const query = await this.loadQuery();

    const abortController = new AbortController();
    const state: RunState = {
      abortController,
      accumulatedInputTokens: 0,
      accumulatedOutputTokens: 0,
      seenMessageIds: new Set(),
      messageCount: 0,
      timeout: options.timeoutMs,
      maxTurns: options.maxTurns,
    };
    this.runningStates.set(runId, state);

    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abortController.abort(); }, options.timeoutMs);

    let resultText = '';
    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;
    let structuredOutput: Record<string, unknown> | undefined;
    let isError = false;
    let errorMessage: string | undefined;
    let killReason: string | undefined;

    const emit = (chunk: string) => {
      resultText += chunk;
      onOutput?.(chunk);
    };

    log(`Starting agent run: cwd=${options.cwd}, timeout=${options.timeoutMs}ms, model=${options.model ?? 'default'}`);

    // Set up sandbox guard
    const sandboxGuard = new SandboxGuard(options.allowedPaths, options.readOnlyPaths);

    log(`Entering SDK message loop`, {
      promptLength: options.prompt.length,
      model: options.model ?? 'default',
      maxTurns: options.maxTurns,
      hasOutputFormat: !!options.outputFormat,
    });

    const startTime = Date.now();

    try {
      for await (const message of query({
        prompt: options.prompt,
        options: {
          cwd: options.cwd,
          abortController,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          model: options.model,
          maxTurns: options.maxTurns,
          ...(options.outputFormat ? { outputFormat: options.outputFormat } : {}),
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
        state.messageCount++;
        if (state.messageCount % 25 === 0) {
          log(`SDK message loop heartbeat: ${state.messageCount} messages processed`);
        }

        if (message.type === 'assistant') {
          const assistantMsg = message as SdkAssistantMessage;
          if (assistantMsg.message.usage) {
            const msgId = assistantMsg.message.id;
            // Deduplicate: parallel tool calls emit multiple assistant messages with the same id and identical usage.
            // Only accumulate once per unique message id. Still emit the usage callback for UI progress regardless.
            if (!msgId || !state.seenMessageIds.has(msgId)) {
              if (msgId) state.seenMessageIds.add(msgId);
              state.accumulatedInputTokens += assistantMsg.message.usage.input_tokens;
              state.accumulatedOutputTokens += assistantMsg.message.usage.output_tokens;
            }
            onMessage?.({ type: 'usage', inputTokens: state.accumulatedInputTokens, outputTokens: state.accumulatedOutputTokens, timestamp: Date.now() });
          }
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              emit(block.text + '\n');
              onMessage?.({ type: 'assistant_text', text: block.text, timestamp: Date.now() });
            } else if (block.type === 'thinking') {
              onMessage?.({ type: 'thinking', text: block.thinking, timestamp: Date.now() });
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
          // Prefer the result message's authoritative cumulative totals.
          // Fall back to accumulated counts only when the result has no usage data.
          costInputTokens = resultMsg.usage?.input_tokens
            ?? (state.accumulatedInputTokens > 0 ? state.accumulatedInputTokens : undefined);
          costOutputTokens = resultMsg.usage?.output_tokens
            ?? (state.accumulatedOutputTokens > 0 ? state.accumulatedOutputTokens : undefined);
          if (costInputTokens != null || costOutputTokens != null) {
            onMessage?.({ type: 'usage', inputTokens: costInputTokens ?? 0, outputTokens: costOutputTokens ?? 0, timestamp: Date.now() } as AgentChatMessage);
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
            if (message.type === 'tool') {
              onMessage?.({ type: 'tool_result', toolId: (otherMsg as unknown as { tool_use_id?: string }).tool_use_id, result: otherMsg.result, timestamp: Date.now() });
            }
          }
        }
      }
      log(`SDK message loop completed: ${state.messageCount} messages, hasStructuredOutput=${!!structuredOutput}, isError=${isError}`, {
        accumulatedInputTokens: state.accumulatedInputTokens,
        accumulatedOutputTokens: state.accumulatedOutputTokens,
        resultInputTokens: costInputTokens,
        resultOutputTokens: costOutputTokens,
      });
    } catch (err) {
      isError = true;
      const sdkError = err instanceof Error ? err.message : String(err);
      errorMessage = sdkError;
      if (timedOut) {
        killReason = 'timeout';
        const elapsed = Date.now() - startTime;
        errorMessage = `Agent timed out after ${Math.round(elapsed / 1000)}s (timeout=${Math.round(options.timeoutMs / 1000)}s, ${state.messageCount} messages processed)`;
        log(`${errorMessage} [sdk: ${sdkError}]`);
      } else if (abortController.signal.aborted) {
        killReason = state.stoppedReason ?? 'stopped';
        const elapsed = Date.now() - startTime;
        errorMessage = `Agent aborted after ${Math.round(elapsed / 1000)}s (${state.messageCount} messages processed) [kill_reason=${killReason}]`;
        log(`${errorMessage} [sdk: ${sdkError}]`);
      } else {
        log(`Agent execution error: ${errorMessage}`);
      }
    } finally {
      clearTimeout(timer);
      this.runningStates.delete(runId);
    }

    const output = resultText || errorMessage || '';
    const exitCode = isError ? 1 : 0;
    return {
      exitCode,
      output,
      error: isError ? errorMessage : undefined,
      costInputTokens,
      costOutputTokens,
      model: options.model ?? this.getDefaultModel(),
      structuredOutput,
      killReason,
      rawExitCode: exitCode,
    };
  }

  async stop(runId: string): Promise<void> {
    const state = this.runningStates.get(runId);
    if (!state) {
      getAppLogger().warn('ClaudeCodeLib', `stop called for unknown runId: ${runId}`);
      return;
    }
    state.stoppedReason = 'stopped';
    state.abortController.abort();
    this.runningStates.delete(runId);
  }

  private async loadQuery(): Promise<(opts: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    return mod.query as (opts: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>;
  }
}
