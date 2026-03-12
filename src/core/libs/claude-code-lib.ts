import type { AgentChatMessage } from '../../shared/types';
import type { IAgentLib, AgentLibFeatures, AgentLibRunOptions, AgentLibCallbacks, AgentLibResult, AgentLibTelemetry, AgentLibModelOption, ModelTokenUsage } from '../interfaces/agent-lib';
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

interface SdkUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

interface SdkAssistantMessage {
  type: 'assistant';
  message: { id?: string; content: SdkContentBlock[]; usage?: SdkUsage };
}
interface SdkResultMessage {
  type: 'result';
  subtype: string;
  errors?: string[];
  structured_output?: Record<string, unknown>;
  usage?: SdkUsage;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  modelUsage?: Record<string, ModelTokenUsage>;
}
interface SdkUserMessage {
  type: 'user';
  message: { role: string; content: unknown };
  parent_tool_use_id: string | null;
  session_id: string;
}
interface SdkSystemMessage {
  type: 'system';
  subtype: string;
  trigger?: string;
  pre_tokens?: number;
  status?: string | null;
}
interface SdkOtherMessage {
  type: string;
  message?: { content?: SdkContentBlock[] };
  summary?: string;
  result?: string;
}
type SdkStreamMessage = SdkAssistantMessage | SdkResultMessage | SdkUserMessage | SdkSystemMessage | SdkOtherMessage;

interface RunState {
  abortController: AbortController;
  accumulatedInputTokens: number;
  accumulatedOutputTokens: number;
  accumulatedCacheReadInputTokens: number;
  accumulatedCacheCreationInputTokens: number;
  /** Input tokens from the most recent assistant message (overwritten each time, not accumulated). */
  lastInputTokens: number | undefined;
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

  supportedFeatures(): AgentLibFeatures {
    return { images: true, hooks: true, thinking: true, nativeResume: true };
  }

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
      accumulatedCacheReadInputTokens: state.accumulatedCacheReadInputTokens,
      accumulatedCacheCreationInputTokens: state.accumulatedCacheCreationInputTokens,
      messageCount: state.messageCount,
      timeout: state.timeout,
      maxTurns: state.maxTurns,
    };
  }

  async execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult> {
    const { onOutput, onLog, onMessage, onUserToolResult, onStreamEvent } = callbacks;
    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);

    const query = await this.loadQuery();

    const abortController = new AbortController();
    const state: RunState = {
      abortController,
      accumulatedInputTokens: 0,
      accumulatedOutputTokens: 0,
      accumulatedCacheReadInputTokens: 0,
      accumulatedCacheCreationInputTokens: 0,
      lastInputTokens: undefined,
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
    let cacheReadInputTokens: number | undefined;
    let cacheCreationInputTokens: number | undefined;
    let totalCostUsd: number | undefined;
    let lastContextInputTokens: number | undefined;
    let structuredOutput: Record<string, unknown> | undefined;
    let isError = false;
    let errorMessage: string | undefined;
    let killReason: string | undefined;
    let contextWindow: number | undefined;
    let maxOutputTokens: number | undefined;
    let durationMs: number | undefined;
    let durationApiMs: number | undefined;
    let numTurns: number | undefined;
    let modelUsage: Record<string, ModelTokenUsage> | undefined;

    // Capture stderr from the Claude Code process for diagnostics
    const stderrChunks: string[] = [];
    const STDERR_MAX = 64 * 1024;
    let stderrLen = 0;
    const onStderr = (chunk: string) => {
      if (stderrLen < STDERR_MAX) {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
      }
    };

    const emit = (chunk: string) => {
      resultText += chunk;
      onOutput?.(chunk);
    };
    /** Stream-only: sent to onOutput for real-time display but NOT stored in resultText */
    const stream = (chunk: string) => {
      onOutput?.(chunk);
    };

    log(`Starting agent run: cwd=${options.cwd}, timeout=${options.timeoutMs}ms, model=${options.model ?? 'default'}`);

    // Set up sandbox guard as a canUseTool wrapper
    const sandboxGuard = new SandboxGuard(options.allowedPaths, options.readOnlyPaths);
    const callerCanUseTool = options.canUseTool;

    // Merge sandbox guard with caller's canUseTool (e.g. AskUserQuestion handler)
    const mergedCanUseTool = async (
      toolName: string,
      input: Record<string, unknown>,
      _sdkOptions: { signal: AbortSignal; suggestions?: unknown[]; blockedPath?: string; decisionReason?: string; toolUseID: string; agentID?: string },
    ): Promise<{ behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message: string }> => {
      // Sandbox guard runs first (synchronous path check)
      const guardResult = sandboxGuard.evaluateToolCall(toolName, input);
      if (!guardResult.allow) {
        log(`Sandbox guard blocked ${toolName}: ${guardResult.reason}`);
        return { behavior: 'deny', message: guardResult.reason ?? 'Blocked by sandbox guard' };
      }
      // Then delegate to caller's canUseTool (e.g. AskUserQuestion handler)
      if (callerCanUseTool) {
        return callerCanUseTool(toolName, input);
      }
      return { behavior: 'allow' };
    };

    // Build SDK prompt: multimodal when images are present, otherwise plain string.
    // Conversation history is handled via native SDK session resume (not manual replay).
    let sdkPrompt: string | AsyncIterable<SdkUserMessage>;
    if (options.images && options.images.length > 0) {
      const contentBlocks = [
        { type: 'text' as const, text: options.prompt },
        ...options.images.map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
        })),
      ];
      const userMessage: SdkUserMessage = {
        type: 'user',
        message: { role: 'user', content: contentBlocks },
        parent_tool_use_id: null,
        session_id: runId,
      };
      sdkPrompt = (async function* () { yield userMessage; })();
    } else {
      sdkPrompt = options.prompt;
    }

    log(`Entering SDK message loop`, {
      promptLength: options.prompt.length,
      model: options.model ?? 'default',
      maxTurns: options.maxTurns,
      hasOutputFormat: !!options.outputFormat,
      hasImages: !!(options.images?.length),
    });

    const startTime = Date.now();

    // Session management (native SDK resume)
    const sessionOptions: Record<string, unknown> = {};
    if (options.resumeSession && options.sessionId) {
      sessionOptions.resume = options.sessionId;
    } else if (options.sessionId) {
      sessionOptions.sessionId = options.sessionId;
    }

    // Build a clean env: remove CLAUDECODE to prevent "nested session" rejection
    // when the daemon itself runs inside a Claude Code session.
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    try {
      for await (const message of query({
        prompt: sdkPrompt,
        options: {
          cwd: options.cwd,
          ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
          abortController,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          model: options.model,
          maxTurns: options.maxTurns,
          thinking: { type: 'adaptive' },
          env: cleanEnv,
          stderr: onStderr,
          includePartialMessages: true,
          ...(options.settingSources?.length ? { settingSources: options.settingSources } : {}),
          ...(options.outputFormat ? { outputFormat: options.outputFormat } : {}),
          ...(options.disallowedTools?.length ? { disallowedTools: options.disallowedTools } : {}),
          canUseTool: mergedCanUseTool,
          ...sessionOptions,
          ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
          ...(options.maxBudgetUsd != null ? { maxBudgetUsd: options.maxBudgetUsd } : {}),
          ...(options.betas?.length ? { betas: options.betas } : {}),
        },
      }) as AsyncIterable<SdkStreamMessage>) {
        // Skip replayed messages during session resume to avoid duplicate callbacks/tokens
        if ('isReplay' in message && (message as Record<string, unknown>).isReplay) {
          continue;
        }

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
              state.accumulatedInputTokens += assistantMsg.message.usage.input_tokens
                + (assistantMsg.message.usage.cache_read_input_tokens ?? 0)
                + (assistantMsg.message.usage.cache_creation_input_tokens ?? 0);
              state.accumulatedOutputTokens += assistantMsg.message.usage.output_tokens;
              state.accumulatedCacheReadInputTokens += assistantMsg.message.usage.cache_read_input_tokens ?? 0;
              state.accumulatedCacheCreationInputTokens += assistantMsg.message.usage.cache_creation_input_tokens ?? 0;
            }
            // Always overwrite (not accumulate): this gives us the input tokens
            // from the most recent API call, which equals the current context window usage.
            state.lastInputTokens = assistantMsg.message.usage.input_tokens
              + (assistantMsg.message.usage.cache_read_input_tokens ?? 0)
              + (assistantMsg.message.usage.cache_creation_input_tokens ?? 0);
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
              stream(`\n> Tool: ${block.name}\n> Input: ${input.slice(0, 2000)}${input.length > 2000 ? '...' : ''}\n`);
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
          // Use the SDK's authoritative total_cost_usd when available — it accounts
          // for cache pricing, multi-model usage, and all billing dimensions.
          if (resultMsg.total_cost_usd != null) {
            totalCostUsd = resultMsg.total_cost_usd;
          }
          // Extract telemetry fields from result
          if (resultMsg.duration_ms != null) durationMs = resultMsg.duration_ms;
          if (resultMsg.duration_api_ms != null) durationApiMs = resultMsg.duration_api_ms;
          if (resultMsg.num_turns != null) numTurns = resultMsg.num_turns;
          if (resultMsg.modelUsage) {
            modelUsage = resultMsg.modelUsage;
            // Extract contextWindow/maxOutputTokens from the primary model (first entry with contextWindow)
            for (const usage of Object.values(resultMsg.modelUsage)) {
              if (usage.contextWindow != null) {
                contextWindow = usage.contextWindow;
                maxOutputTokens = usage.maxOutputTokens;
                break;
              }
            }
          }
          // Prefer the result message's authoritative cumulative totals.
          // Fall back to accumulated counts only when the result has no usage data.
          costInputTokens = resultMsg.usage?.input_tokens
            ?? (state.accumulatedInputTokens >= 0 ? state.accumulatedInputTokens : undefined);
          costOutputTokens = resultMsg.usage?.output_tokens
            ?? (state.accumulatedOutputTokens >= 0 ? state.accumulatedOutputTokens : undefined);
          cacheReadInputTokens = resultMsg.usage?.cache_read_input_tokens
            ?? (state.accumulatedCacheReadInputTokens >= 0 ? state.accumulatedCacheReadInputTokens : undefined);
          cacheCreationInputTokens = resultMsg.usage?.cache_creation_input_tokens
            ?? (state.accumulatedCacheCreationInputTokens >= 0 ? state.accumulatedCacheCreationInputTokens : undefined);
          lastContextInputTokens = state.lastInputTokens;
          if (costInputTokens != null || costOutputTokens != null) {
            const usageMsg: AgentChatMessage = { type: 'usage', inputTokens: costInputTokens ?? 0, outputTokens: costOutputTokens ?? 0, contextWindow, timestamp: Date.now() };
            onMessage?.(usageMsg);
          }
        } else if (message.type === 'system') {
          const sysMsg = message as SdkSystemMessage;
          if (sysMsg.subtype === 'compact_boundary') {
            log(`Context compaction boundary: trigger=${sysMsg.trigger}, preTokens=${sysMsg.pre_tokens}`);
            stream(`\n[Context compacted: ${sysMsg.trigger}, ${sysMsg.pre_tokens} tokens before compaction]\n`);
            onMessage?.({ type: 'compact_boundary', trigger: sysMsg.trigger ?? 'unknown', preTokens: sysMsg.pre_tokens ?? 0, timestamp: Date.now() });
          } else if (sysMsg.subtype === 'status') {
            if (sysMsg.status === 'compacting') {
              onMessage?.({ type: 'compacting', active: true, timestamp: Date.now() });
            } else if (sysMsg.status === null) {
              onMessage?.({ type: 'compacting', active: false, timestamp: Date.now() });
            } else {
              log(`Unhandled system status: ${sysMsg.status}`);
            }
          }
        } else if (message.type === 'user') {
          // SDK emits tool results as user messages with tool_result content blocks
          const userMsg = message as SdkUserMessage;
          const content = userMsg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              const b = block as { type: string; tool_use_id?: string; content?: unknown };
              if (b.type === 'tool_result' && b.tool_use_id) {
                const resultContent = typeof b.content === 'string' ? b.content
                  : (Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c.text || '').join('') : '(no output)');
                onUserToolResult?.(b.tool_use_id, resultContent);
              }
            }
          }
        } else if (message.type === 'stream_event') {
          // Partial message streaming: forward raw stream event to callback
          const streamMsg = message as { type: 'stream_event'; event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string; partial_json?: string } } };
          if (onStreamEvent && streamMsg.event) {
            onStreamEvent(streamMsg.event as { type: string; [key: string]: unknown });
          }
          // Also extract text/thinking deltas and emit as onMessage for UI rendering
          const evt = streamMsg.event;
          if (evt?.type === 'content_block_delta' && evt.delta) {
            const delta = evt.delta;
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              onMessage?.({ type: 'stream_delta', deltaType: 'text_delta', delta: delta.text, timestamp: Date.now() });
            } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
              onMessage?.({ type: 'stream_delta', deltaType: 'thinking_delta', delta: delta.thinking, timestamp: Date.now() });
            } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              onMessage?.({ type: 'stream_delta', deltaType: 'input_json_delta', delta: delta.partial_json, timestamp: Date.now() });
            }
          }
        } else {
          const otherMsg = message as SdkOtherMessage;
          if (otherMsg.message?.content) {
            for (const block of otherMsg.message.content) {
              if (block.type === 'text') {
                stream(`[${message.type}] ${block.text}\n`);
              }
            }
          } else if (typeof otherMsg.summary === 'string') {
            stream(`[${message.type}] ${otherMsg.summary}\n`);
          } else if (typeof otherMsg.result === 'string') {
            stream(`[${message.type}] ${otherMsg.result}\n`);
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
      const sdkStack = err instanceof Error ? err.stack : undefined;
      const elapsed = Date.now() - startTime;
      errorMessage = sdkError;

      // Collect stderr output from the Claude Code process
      const stderrOutput = stderrChunks.join('').trim();

      // Build diagnostic context that will be included in the error for debugging
      const diagnostics = [
        `sdk_error: ${sdkError}`,
        ...(stderrOutput ? [`stderr: ${stderrOutput}`] : []),
        ...(sdkStack ? [`stack: ${sdkStack}`] : []),
        `elapsed: ${Math.round(elapsed / 1000)}s`,
        `messages_processed: ${state.messageCount}`,
        `cwd: ${options.cwd}`,
        `model: ${options.model ?? 'default'}`,
        `max_turns: ${options.maxTurns}`,
        `timeout: ${Math.round(options.timeoutMs / 1000)}s`,
        ...(options.resumeSession ? [`resume_session: ${options.sessionId}`] : []),
        `accumulated_tokens: ${state.accumulatedInputTokens}/${state.accumulatedOutputTokens}`,
        `result_text_length: ${resultText.length}`,
      ].join('\n');

      if (timedOut) {
        killReason = 'timeout';
        errorMessage = `Agent timed out after ${Math.round(elapsed / 1000)}s (timeout=${Math.round(options.timeoutMs / 1000)}s, ${state.messageCount} messages processed)`;
      } else if (abortController.signal.aborted) {
        killReason = state.stoppedReason ?? 'stopped';
        errorMessage = `Agent aborted after ${Math.round(elapsed / 1000)}s (${state.messageCount} messages processed) [kill_reason=${killReason}]`;
      } else if (options.resumeSession) {
        // Session resume failure — provide a clear, actionable message
        errorMessage = `Session resume failed (session "${options.sessionId}"): ${sdkError}\n\n--- Diagnostics ---\n${diagnostics}`;
      } else {
        // For unexpected errors (like "process exited with code 1"), include diagnostics in the error message
        errorMessage = `${sdkError}\n\n--- Diagnostics ---\n${diagnostics}`;
      }
      log(`Agent execution error`, {
        error: sdkError,
        ...(stderrOutput ? { stderr: stderrOutput } : {}),
        stack: sdkStack,
        elapsed,
        messagesProcessed: state.messageCount,
        cwd: options.cwd,
        model: options.model,
        maxTurns: options.maxTurns,
        timeout: options.timeoutMs,
        resumeSession: options.resumeSession,
        sessionId: options.sessionId,
        accumulatedInputTokens: state.accumulatedInputTokens,
        accumulatedOutputTokens: state.accumulatedOutputTokens,
        resultTextLength: resultText.length,
        timedOut,
        aborted: abortController.signal.aborted,
        killReason,
      });
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
      cacheReadInputTokens,
      cacheCreationInputTokens,
      totalCostUsd,
      lastContextInputTokens,
      model: options.model ?? this.getDefaultModel(),
      structuredOutput,
      killReason,
      rawExitCode: exitCode,
      contextWindow,
      maxOutputTokens,
      durationMs,
      durationApiMs,
      numTurns,
      modelUsage,
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

  private async loadQuery(): Promise<(opts: { prompt: string | AsyncIterable<SdkUserMessage>; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    return mod.query as (opts: { prompt: string | AsyncIterable<SdkUserMessage>; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>;
  }
}
