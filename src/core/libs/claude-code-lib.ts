import type { AgentChatMessage } from '../../shared/types';
import type { AgentLibFeatures, AgentLibModelOption, AgentLibHooks, ModelTokenUsage, QueryEvent } from '../interfaces/agent-lib';
import type { GenericMcpToolDefinition } from '../interfaces/mcp-tool';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { BaseAgentLib, type BaseRunState, type EngineRunOptions, type EngineResult } from './base-agent-lib';
import { createMessageChannel, type MessageChannel } from '../utils/message-channel';

// Use Function constructor to preserve dynamic import() at runtime.
// TypeScript compiles `await import(...)` to `require()` under CommonJS,
// but the SDK is ESM-only (.mjs). This bypasses that transformation.
const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

// Module-level cache for createSdkMcpServer — the SDK is ESM-only so the dynamic import is
// expensive. Cache after the first load; subsequent calls return synchronously.
let cachedCreateSdkMcpServer: ((opts: { name: string; version?: string; tools?: GenericMcpToolDefinition[] }) => McpSdkServerConfigWithInstance) | undefined;

async function loadCreateSdkMcpServer(): Promise<(opts: { name: string; version?: string; tools?: GenericMcpToolDefinition[] }) => McpSdkServerConfigWithInstance> {
  if (!cachedCreateSdkMcpServer) {
    const sdk = await importESM('@anthropic-ai/claude-agent-sdk');
    cachedCreateSdkMcpServer = sdk.createSdkMcpServer as (opts: {
      name: string;
      version?: string;
      tools?: GenericMcpToolDefinition[];
    }) => McpSdkServerConfigWithInstance;
  }
  return cachedCreateSdkMcpServer;
}

// ============================================
// SDK message types (engine-specific)
// ============================================

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
  parent_tool_use_id?: string | null;
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
  /** @deprecated — SDK now nests these under compact_metadata */
  trigger?: string;
  /** @deprecated — SDK now nests these under compact_metadata */
  pre_tokens?: number;
  compact_metadata?: { trigger: 'manual' | 'auto'; pre_tokens: number };
  status?: string | null;
}
interface SdkOtherMessage {
  type: string;
  message?: { content?: SdkContentBlock[] };
  summary?: string;
  result?: string;
}
type SdkStreamMessage = SdkAssistantMessage | SdkResultMessage | SdkUserMessage | SdkSystemMessage | SdkOtherMessage;

// ============================================
// ClaudeCodeLib — Claude Agent SDK engine
// ============================================

export class ClaudeCodeLib extends BaseAgentLib {
  readonly name = 'claude-code';

  /** Track seen message IDs per run to avoid duplicate token counting. */
  private seenMessageIds = new Map<string, Set<string>>();

  /** Track active message channels for mid-execution injection, keyed by runId. */
  private activeChannels = new Map<string, MessageChannel<SdkUserMessage>>();

  supportedFeatures(): AgentLibFeatures {
    return { images: true, hooks: true, thinking: true, nativeResume: true, streamingInput: true };
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

  protected async runEngine(
    runId: string,
    state: BaseRunState,
    engineOpts: EngineRunOptions,
  ): Promise<EngineResult> {
    const { prompt, options, callbacks, canUseTool, hooks, log, emit, stream, getResultLength } = engineOpts;
    const { onMessage, onUserToolResult, onStreamEvent } = callbacks;

    const query = await this.loadQuery();

    // Track seen message IDs for dedup
    const seenIds = new Set<string>();
    this.seenMessageIds.set(runId, seenIds);

    let lastInputTokens: number | undefined;

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

    // Build SDK prompt: use Single Message Input (string) by default.
    // When enableStreamingInput is on, always use a long-lived message channel (AsyncGenerator)
    // so that mid-execution messages can be injected. When images are attached, also use
    // an AsyncGenerator (need content blocks). When neither applies, use a plain string.
    let sdkPrompt: string | AsyncIterable<SdkUserMessage>;
    let messageChannel: MessageChannel<SdkUserMessage> | undefined;

    const useStreamingInput = engineOpts.enableStreamingInput;

    if (useStreamingInput) {
      // Long-lived message channel for injection support.
      // The initial user message is pushed first; the channel stays open for injected messages.
      messageChannel = createMessageChannel<SdkUserMessage>();
      this.activeChannels.set(runId, messageChannel);

      const initialMsg = this.buildSdkUserMessage(prompt, options.images, runId);
      messageChannel.push(initialMsg);
      sdkPrompt = messageChannel;
    } else if (options.images && options.images.length > 0) {
      // One-shot AsyncGenerator for images (no injection support)
      const imageMsg = this.buildSdkUserMessage(prompt, options.images, runId);
      sdkPrompt = (async function* () { yield imageMsg; })();
    } else {
      sdkPrompt = prompt;
    }

    log(`Entering SDK message loop`, {
      promptLength: prompt.length,
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
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    // Set a generous max output token limit to prevent the SDK from aborting with
    // "Claude's response exceeded the N output token maximum" and then retrying
    // indefinitely (which hangs the agent). Default SDK limit (32001) is too low
    // for agents doing large code generation.
    if (!cleanEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS) {
      cleanEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '128000';
    }

    // Build SDK hooks from our AgentLibHooks (engine-specific format transformation)
    const sdkHooks = this.buildSdkHooks(hooks, log);

    // Merge external mcpServers with in-process tool definitions (if any).
    // Each entry in mcpTools becomes its own SDK server — the key is used as both the
    // server name and the mcpServers key, so adding new MCPs requires no changes here.
    let mergedMcpServers: Record<string, unknown> | undefined = options.mcpServers;
    if (options.mcpTools && Object.keys(options.mcpTools).length > 0) {
      const createSdkMcpServer = await loadCreateSdkMcpServer();
      const inProcessServers: Record<string, unknown> = {};
      for (const [serverName, tools] of Object.entries(options.mcpTools)) {
        inProcessServers[serverName] = createSdkMcpServer({ name: serverName, tools });
      }
      mergedMcpServers = { ...(options.mcpServers ?? {}), ...inProcessServers };
    }

    // Result tracking
    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;
    let cacheReadInputTokens: number | undefined;
    let cacheCreationInputTokens: number | undefined;
    let totalCostUsd: number | undefined;
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

    try {
      for await (const message of query({
        prompt: sdkPrompt,
        options: {
          cwd: options.cwd,
          ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
          abortController: state.abortController,
          permissionMode: options.sdkPermissionMode ?? 'acceptEdits',
          model: options.model,
          maxTurns: options.maxTurns,
          thinking: { type: 'adaptive' },
          env: cleanEnv,
          stderr: onStderr,
          includePartialMessages: true,
          ...(options.settingSources?.length ? { settingSources: options.settingSources } : {}),
          ...(options.outputFormat ? { outputFormat: options.outputFormat } : {}),
          ...(options.disallowedTools?.length ? { disallowedTools: options.disallowedTools } : {}),
          canUseTool,
          ...(Object.keys(sdkHooks).length > 0 ? { hooks: sdkHooks } : {}),
          ...sessionOptions,
          ...(mergedMcpServers ? { mcpServers: mergedMcpServers } : {}),
          ...(options.maxBudgetUsd != null ? { maxBudgetUsd: options.maxBudgetUsd } : {}),
          ...(options.betas?.length ? { betas: options.betas } : {}),
          ...(options.agents && Object.keys(options.agents).length > 0 ? { agents: options.agents } : {}),
          ...(options.plugins?.length ? { plugins: options.plugins } : {}),
        },
      }) as AsyncIterable<SdkStreamMessage>) {
        // Skip replayed messages during session resume to avoid duplicate callbacks/tokens
        if ('isReplay' in message && (message as Record<string, unknown>).isReplay) {
          continue;
        }

        state.messageCount++;

        if (message.type === 'assistant') {
          const assistantMsg = message as SdkAssistantMessage;
          // Subagent messages have a non-null parent_tool_use_id
          const parentToolUseId = assistantMsg.parent_tool_use_id ?? undefined;
          if (assistantMsg.message.usage) {
            const msgId = assistantMsg.message.id;
            if (!msgId || !seenIds.has(msgId)) {
              if (msgId) seenIds.add(msgId);
              state.accumulatedInputTokens += assistantMsg.message.usage.input_tokens;
              state.accumulatedOutputTokens += assistantMsg.message.usage.output_tokens;
              state.accumulatedCacheReadInputTokens += assistantMsg.message.usage.cache_read_input_tokens ?? 0;
              state.accumulatedCacheCreationInputTokens += assistantMsg.message.usage.cache_creation_input_tokens ?? 0;
            }
            // Only update lastInputTokens for parent-level messages (not sub-agents)
            // so the context bar reflects the parent conversation's actual context usage.
            if (!parentToolUseId) {
              lastInputTokens = assistantMsg.message.usage.input_tokens
                + (assistantMsg.message.usage.cache_read_input_tokens ?? 0)
                + (assistantMsg.message.usage.cache_creation_input_tokens ?? 0);
            }
            onMessage?.({ type: 'usage', inputTokens: state.accumulatedInputTokens, outputTokens: state.accumulatedOutputTokens, lastContextInputTokens: lastInputTokens, timestamp: Date.now() });
          }
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              emit(block.text + '\n');
              onMessage?.({ type: 'assistant_text', text: block.text, timestamp: Date.now(), ...(parentToolUseId ? { parentToolUseId } : {}) });
            } else if (block.type === 'thinking') {
              onMessage?.({ type: 'thinking', text: block.thinking, timestamp: Date.now(), ...(parentToolUseId ? { parentToolUseId } : {}) });
            } else if (block.type === 'tool_use') {
              const input = JSON.stringify(block.input ?? {});
              stream(`\n> Tool: ${block.name}\n> Input: ${input.slice(0, 2000)}${input.length > 2000 ? '...' : ''}\n`);
              onMessage?.({ type: 'tool_use', toolName: block.name, toolId: (block as unknown as { id?: string }).id, input: input.slice(0, 2000), timestamp: Date.now(), ...(parentToolUseId ? { parentToolUseId } : {}) });
            }
          }
        } else if (message.type === 'result') {
          const resultMsg = message as SdkResultMessage;
          if (resultMsg.subtype !== 'success') {
            isError = true;
            if (resultMsg.subtype === 'error_max_turns') {
              errorMessage = `Agent reached the maximum turn limit (${options.maxTurns ?? 'unknown'} turns). You can continue the conversation to pick up where it left off.`;
            } else {
              errorMessage = resultMsg.errors?.join('\n') || `Agent execution ended with status: ${resultMsg.subtype}`;
            }
          }
          if (resultMsg.structured_output) {
            structuredOutput = resultMsg.structured_output;
          }
          if (resultMsg.total_cost_usd != null) {
            totalCostUsd = resultMsg.total_cost_usd;
          }
          if (resultMsg.duration_ms != null) durationMs = resultMsg.duration_ms;
          if (resultMsg.duration_api_ms != null) durationApiMs = resultMsg.duration_api_ms;
          if (resultMsg.num_turns != null) numTurns = resultMsg.num_turns;
          if (resultMsg.modelUsage) {
            modelUsage = resultMsg.modelUsage;
            for (const usage of Object.values(resultMsg.modelUsage)) {
              if (usage.contextWindow != null) {
                contextWindow = usage.contextWindow;
                maxOutputTokens = usage.maxOutputTokens;
                break;
              }
            }
          }
          // Prefer modelUsage (includes subagent tokens) over usage (parent-only)
          if (resultMsg.modelUsage && Object.keys(resultMsg.modelUsage).length > 0) {
            const usageValues = Object.values(resultMsg.modelUsage);
            costInputTokens = usageValues.reduce((sum, m) => sum + m.inputTokens, 0);
            costOutputTokens = usageValues.reduce((sum, m) => sum + m.outputTokens, 0);
            cacheReadInputTokens = usageValues.reduce((sum, m) => sum + m.cacheReadInputTokens, 0);
            cacheCreationInputTokens = usageValues.reduce((sum, m) => sum + m.cacheCreationInputTokens, 0);
          } else {
            costInputTokens = resultMsg.usage?.input_tokens
              ?? (state.accumulatedInputTokens >= 0 ? state.accumulatedInputTokens : undefined);
            costOutputTokens = resultMsg.usage?.output_tokens
              ?? (state.accumulatedOutputTokens >= 0 ? state.accumulatedOutputTokens : undefined);
            cacheReadInputTokens = resultMsg.usage?.cache_read_input_tokens
              ?? (state.accumulatedCacheReadInputTokens >= 0 ? state.accumulatedCacheReadInputTokens : undefined);
            cacheCreationInputTokens = resultMsg.usage?.cache_creation_input_tokens
              ?? (state.accumulatedCacheCreationInputTokens >= 0 ? state.accumulatedCacheCreationInputTokens : undefined);
          }
          if (costInputTokens != null || costOutputTokens != null) {
            const usageMsg: AgentChatMessage = { type: 'usage', inputTokens: costInputTokens ?? 0, outputTokens: costOutputTokens ?? 0, contextWindow, lastContextInputTokens: lastInputTokens, timestamp: Date.now() };
            onMessage?.(usageMsg);
          }
          // Close the message channel after processing the SDK result.
          // The result is the terminal event for a turn — the SDK is done processing.
          // Without this, the SDK waits for the next input from the channel while the
          // for-await loop waits for more SDK output, causing a deadlock.
          if (messageChannel && !messageChannel.isClosed) {
            log('Closing message channel after SDK result');
            messageChannel.close();
          }
        } else if (message.type === 'system') {
          const sysMsg = message as SdkSystemMessage;
          if (sysMsg.subtype === 'compact_boundary') {
            // SDK nests trigger/pre_tokens under compact_metadata; fall back to top-level for compat
            const trigger = sysMsg.compact_metadata?.trigger ?? sysMsg.trigger ?? 'unknown';
            const preTokens = sysMsg.compact_metadata?.pre_tokens ?? sysMsg.pre_tokens ?? 0;
            log(`Context compaction boundary: trigger=${trigger}, preTokens=${preTokens}`);
            stream(`\n[Context compacted: ${trigger}, ${preTokens} tokens before compaction]\n`);
            onMessage?.({ type: 'compact_boundary', trigger, preTokens, timestamp: Date.now() });
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
          const userMsg = message as SdkUserMessage;
          const parentToolUseId = userMsg.parent_tool_use_id ?? undefined;
          const content = userMsg.message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              const b = block as { type: string; tool_use_id?: string; content?: unknown };
              if (b.type === 'tool_result' && b.tool_use_id) {
                const resultContent = typeof b.content === 'string' ? b.content
                  : (Array.isArray(b.content) ? b.content.map((c: { text?: string }) => c.text || '').join('') : '(no output)');
                if (parentToolUseId) {
                  // Subagent tool_result — emit via onMessage with parentToolUseId tag
                  onMessage?.({ type: 'tool_result', toolId: b.tool_use_id, result: resultContent, timestamp: Date.now(), parentToolUseId });
                } else {
                  // Parent tool_result — use existing callback
                  onUserToolResult?.(b.tool_use_id, resultContent);
                }
              }
            }
          }
        } else if (message.type === 'stream_event') {
          const streamMsg = message as { type: 'stream_event'; event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string; partial_json?: string } } };
          if (onStreamEvent && streamMsg.event) {
            onStreamEvent(streamMsg.event as { type: string; [key: string]: unknown });
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
      const stderrOutput = stderrChunks.join('').trim();

      const result = this.handleEngineError(err, state, options, {
        engineLabel: 'Agent',
        elapsedMs: elapsed,
        diagnosticsExtra: {
          sdk_error: sdkError,
          ...(stderrOutput ? { stderr: stderrOutput } : {}),
          ...(sdkStack ? { stack: sdkStack } : {}),
          elapsed: `${Math.round(elapsed / 1000)}s`,
          result_text_length: getResultLength(),
        },
      });
      killReason = result.killReason;
      errorMessage = result.errorMessage;

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
        resultTextLength: getResultLength(),
        aborted: state.abortController.signal.aborted,
        killReason,
      });
    } finally {
      this.seenMessageIds.delete(runId);
      // Close the message channel if one was created, and remove from active channels
      if (messageChannel) {
        messageChannel.close();
        this.activeChannels.delete(runId);
      }
    }

    return {
      isError,
      errorMessage,
      killReason,
      rawExitCode: isError ? 1 : 0,
      structuredOutput,
      costInputTokens,
      costOutputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      totalCostUsd,
      lastContextInputTokens: lastInputTokens,
      contextWindow,
      maxOutputTokens,
      durationMs,
      durationApiMs,
      numTurns,
      modelUsage,
    };
  }

  /**
   * Inject a user message into a running agent session via the active message channel.
   * Returns true if successfully pushed, false if no active channel or channel is closed.
   */
  override injectMessage(runId: string, message: string, images?: Array<{ base64: string; mediaType: string }>): boolean {
    const channel = this.activeChannels.get(runId);
    if (!channel || channel.isClosed) return false;

    const userMsg = this.buildSdkUserMessage(message, images, runId);
    return channel.push(userMsg);
  }

  /**
   * Build an SdkUserMessage from text and optional images.
   * Used for both the initial prompt message and injected messages.
   */
  private buildSdkUserMessage(
    text: string,
    images: Array<{ base64: string; mediaType: string }> | undefined,
    sessionId: string,
  ): SdkUserMessage {
    if (images && images.length > 0) {
      const contentBlocks = [
        { type: 'text' as const, text },
        ...images.map((img) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
        })),
      ];
      return {
        type: 'user',
        message: { role: 'user', content: contentBlocks },
        parent_tool_use_id: null,
        session_id: sessionId,
      };
    }
    return {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: sessionId,
    };
  }

  /**
   * Transform our AgentLibHooks interface into the SDK's hook format.
   * The SDK expects: `Partial<Record<HookEvent, HookCallbackMatcher[]>>`
   * Sandbox guard runs in the base class's canUseTool chain, not here.
   */
  private buildSdkHooks(
    hooks: AgentLibHooks | undefined,
    log: (msg: string, data?: Record<string, unknown>) => void,
  ): Record<string, unknown> {
    const sdkHooks: Record<string, Array<{ hooks: Array<(input: Record<string, unknown>, toolUseID: string | undefined, options: { signal: AbortSignal }) => Promise<Record<string, unknown>>> }>> = {};

    // PreToolUse hook — used for worktree path guards and other pre-execution checks
    if (hooks?.preToolUse) {
      const preToolUseHandler = hooks.preToolUse;
      sdkHooks.PreToolUse = [{
        hooks: [async (input: Record<string, unknown>) => {
          try {
            const result = preToolUseHandler(
              input.tool_name as string,
              (input.tool_input ?? {}) as Record<string, unknown>,
            );
            if (result?.decision === 'block') {
              log(`PreToolUse hook BLOCKED ${input.tool_name}: ${result.reason}`);
              return { decision: 'block', reason: result.reason ?? 'Blocked by PreToolUse hook' };
            }
          } catch (err) {
            log(`PreToolUse hook CRITICAL ERROR — blocking tool call: ${err instanceof Error ? err.message : String(err)}`);
            return { decision: 'block', reason: `Worktree guard error (fail-closed): ${err instanceof Error ? err.message : String(err)}` };
          }
          return {};
        }],
      }];
    }

    // PostToolUse hook
    if (hooks?.postToolUse) {
      const postToolUseHandler = hooks.postToolUse;
      sdkHooks.PostToolUse = [{
        hooks: [async (input: Record<string, unknown>) => {
          try {
            const result = postToolUseHandler({
              hookEventName: 'PostToolUse',
              toolName: input.tool_name as string,
              toolInput: input.tool_input,
              toolResponse: input.tool_response,
              toolUseId: input.tool_use_id as string,
            });
            if (result?.additionalContext) {
              return {
                continue: true,
                hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: result.additionalContext },
              };
            }
          } catch (err) {
            log(`PostToolUse hook error: ${err instanceof Error ? err.message : String(err)}`);
          }
          return { continue: true };
        }],
      }];
    }

    // PostToolUseFailure hook
    if (hooks?.postToolUseFailure) {
      const failureHandler = hooks.postToolUseFailure;
      sdkHooks.PostToolUseFailure = [{
        hooks: [async (input: Record<string, unknown>) => {
          try {
            const result = failureHandler({
              hookEventName: 'PostToolUseFailure',
              toolName: input.tool_name as string,
              toolInput: input.tool_input,
              error: input.error as string,
              toolUseId: input.tool_use_id as string,
            });
            if (result?.additionalContext) {
              return {
                continue: true,
                hookSpecificOutput: { hookEventName: 'PostToolUseFailure', additionalContext: result.additionalContext },
              };
            }
          } catch (err) {
            log(`PostToolUseFailure hook error: ${err instanceof Error ? err.message : String(err)}`);
          }
          return { continue: true };
        }],
      }];
    }

    // Notification hook
    if (hooks?.notification) {
      const notifHandler = hooks.notification;
      sdkHooks.Notification = [{
        hooks: [async (input: Record<string, unknown>) => {
          try {
            notifHandler({
              hookEventName: 'Notification',
              message: input.message as string,
              title: input.title as string | undefined,
              notificationType: input.notification_type as string,
            });
          } catch (err) {
            log(`Notification hook error: ${err instanceof Error ? err.message : String(err)}`);
          }
          return { continue: true };
        }],
      }];
    }

    // Stop hook
    if (hooks?.stop) {
      const stopHandler = hooks.stop;
      sdkHooks.Stop = [{
        hooks: [async (input: Record<string, unknown>) => {
          try {
            stopHandler({
              hookEventName: 'Stop',
              stopHookActive: input.stop_hook_active as boolean,
            });
          } catch (err) {
            log(`Stop hook error: ${err instanceof Error ? err.message : String(err)}`);
          }
          return { continue: true };
        }],
      }];
    }

    // SubagentStart hook
    if (hooks?.subagentStart) {
      const startHandler = hooks.subagentStart;
      sdkHooks.SubagentStart = [{
        hooks: [async (input: Record<string, unknown>) => {
          try {
            const result = startHandler({
              hookEventName: 'SubagentStart',
              agentId: input.agent_id as string,
              agentType: input.agent_type as string,
            });
            if (result?.additionalContext) {
              return {
                continue: true,
                hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: result.additionalContext },
              };
            }
          } catch (err) {
            log(`SubagentStart hook error: ${err instanceof Error ? err.message : String(err)}`);
          }
          return { continue: true };
        }],
      }];
    }

    // SubagentStop hook
    if (hooks?.subagentStop) {
      const stopHandler = hooks.subagentStop;
      sdkHooks.SubagentStop = [{
        hooks: [async (input: Record<string, unknown>) => {
          try {
            stopHandler({
              hookEventName: 'SubagentStop',
              stopHookActive: input.stop_hook_active as boolean,
              agentId: input.agent_id as string,
              agentType: input.agent_type as string,
            });
          } catch (err) {
            log(`SubagentStop hook error: ${err instanceof Error ? err.message : String(err)}`);
          }
          return { continue: true };
        }],
      }];
    }

    // PreCompact hook
    if (hooks?.preCompact) {
      const compactHandler = hooks.preCompact;
      sdkHooks.PreCompact = [{
        hooks: [async (input: Record<string, unknown>) => {
          try {
            compactHandler({
              hookEventName: 'PreCompact',
              trigger: input.trigger as 'manual' | 'auto',
              customInstructions: input.custom_instructions as string | null,
            });
          } catch (err) {
            log(`PreCompact hook error: ${err instanceof Error ? err.message : String(err)}`);
          }
          return { continue: true };
        }],
      }];
    }

    return sdkHooks;
  }

  /**
   * One-shot query for summarization or session naming.
   * Reuses loadQuery() and yields QueryTextEvent / QueryResultEvent events.
   */
  async *query(prompt: string, options?: { model?: string; maxTokens?: number }): AsyncIterable<QueryEvent> {
    const queryFn = await this.loadQuery();
    for await (const message of queryFn({
      prompt,
      options: {
        maxTurns: 1,
        ...(options?.model ? { model: options.model } : {}),
      },
    }) as AsyncIterable<SdkStreamMessage>) {
      if (message.type === 'assistant') {
        const assistantMsg = message as SdkAssistantMessage;
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text') {
            yield { type: 'text', text: (block as SdkTextBlock).text };
          }
        }
      } else if (message.type === 'result') {
        const resultMsg = message as SdkResultMessage;
        yield {
          type: 'result',
          usage: resultMsg.usage ? {
            input_tokens: resultMsg.usage.input_tokens,
            output_tokens: resultMsg.usage.output_tokens,
            cache_read_input_tokens: resultMsg.usage.cache_read_input_tokens ?? undefined,
            cache_creation_input_tokens: resultMsg.usage.cache_creation_input_tokens ?? undefined,
          } : undefined,
          total_cost_usd: resultMsg.total_cost_usd ?? undefined,
        };
      }
    }
  }

  private async loadQuery(): Promise<(opts: { prompt: string | AsyncIterable<SdkUserMessage>; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    return mod.query as (opts: { prompt: string | AsyncIterable<SdkUserMessage>; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>;
  }
}
