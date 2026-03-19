import type {
  IAgentLib,
  AgentLibFeatures,
  AgentLibRunOptions,
  AgentLibCallbacks,
  AgentLibResult,
  AgentLibTelemetry,
  AgentLibModelOption,
  AgentLibHooks,
  ModelTokenUsage,
  QueryEvent,
} from '../interfaces/agent-lib';
import type { ISessionHistoryProvider } from '../interfaces/session-history-provider';
import { SessionHistoryFormatter } from '../services/session-history-formatter';
import { SandboxGuard } from '../services/sandbox-guard';
import { getAppLogger } from '../services/app-logger';

// ============================================
// Shared RunState — base fields common to all engines
// ============================================

export interface BaseRunState {
  readonly abortController: AbortController;
  accumulatedInputTokens: number;
  accumulatedOutputTokens: number;
  accumulatedCacheReadInputTokens: number;
  accumulatedCacheCreationInputTokens: number;
  messageCount: number;
  readonly timeout?: number;
  readonly maxTurns: number;
  /** Set by the timeout handler or doStop() before aborting, so catch blocks can distinguish timeout from user-initiated stop. */
  stoppedReason?: string;
}

// ============================================
// CanUseTool callback type (Claude SDK-compatible signature)
// ============================================

export type CanUseToolCallback = (
  toolName: string,
  input: Record<string, unknown>,
  sdkOptions: { signal: AbortSignal; toolUseID: string; agentID?: string },
) => Promise<
  { behavior: 'allow'; updatedInput?: Record<string, unknown> } |
  { behavior: 'deny'; message: string }
>;

// ============================================
// Engine result — returned by concrete runEngine()
// ============================================

export interface EngineResult {
  isError: boolean;
  errorMessage?: string;
  /** Used when the engine has output not captured via emit() (e.g. Codex's finalAssistantText fallback). */
  fallbackOutput?: string;
  killReason?: string;
  rawExitCode?: number;
  structuredOutput?: Record<string, unknown>;
  /** SDK-authoritative token counts (override accumulated state if present). */
  costInputTokens?: number;
  costOutputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalCostUsd?: number;
  lastContextInputTokens?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  durationMs?: number;
  durationApiMs?: number;
  numTurns?: number;
  modelUsage?: Record<string, ModelTokenUsage>;
}

// ============================================
// EngineRunOptions — what the base passes to runEngine()
// ============================================

export interface EngineRunOptions {
  /** The original prompt from the caller. Engines handle session resume themselves. */
  prompt: string;
  /** The original options from the caller. */
  options: AgentLibRunOptions;
  /** The callbacks from the caller. */
  callbacks: AgentLibCallbacks;
  /** Pre-built permission chain (sandbox guard + caller interceptor + UI approval). */
  canUseTool: CanUseToolCallback;
  /** Pre-built SDK hooks (only for engines that support native hooks). */
  hooks?: AgentLibHooks;
  /** Log helper bound to the run. */
  log: (msg: string, data?: Record<string, unknown>) => void;
  /** Append to resultText AND stream to onOutput. */
  emit: (chunk: string) => void;
  /** Stream to onOutput only (not persisted in resultText). */
  stream: (chunk: string) => void;
  /** Get the current accumulated result text length (for diagnostics). */
  getResultLength: () => number;
  /** When true, the engine should use a long-lived AsyncGenerator prompt to support mid-execution message injection. */
  enableStreamingInput?: boolean;
}

// ============================================
// BaseAgentLib — abstract base class
// ============================================

export abstract class BaseAgentLib implements IAgentLib {
  abstract readonly name: string;

  private runningStates = new Map<string, BaseRunState>();

  constructor(protected sessionHistoryProvider?: ISessionHistoryProvider) {}

  abstract supportedFeatures(): AgentLibFeatures;
  abstract getDefaultModel(): string;
  abstract getSupportedModels(): AgentLibModelOption[];
  abstract isAvailable(): Promise<boolean>;

  /**
   * Engine-specific execution. Concrete libs implement this to call their SDK/subprocess.
   * The base class handles: timeout, abort, permission chain, telemetry state, and result assembly.
   * Engines can call resolveSessionPrompt() for prompt-based session resume.
   */
  protected abstract runEngine(
    runId: string,
    state: BaseRunState,
    engineOpts: EngineRunOptions,
  ): Promise<EngineResult>;

  /**
   * Engine-specific stop logic. Default: abort the controller.
   * Override for subprocess-based engines that need SIGTERM/SIGKILL.
   */
  protected doStop(runId: string, state: BaseRunState): void {
    state.stoppedReason = 'stopped';
    state.abortController.abort();
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
    const { onOutput, onLog, onPermissionRequest } = callbacks;
    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);

    const features = this.supportedFeatures();

    // Guard against duplicate runId (would orphan the previous run's timer and state)
    if (this.runningStates.has(runId)) {
      throw new Error(`Duplicate runId: ${runId} is already executing on ${this.name}`);
    }

    // Create shared run state
    const abortController = new AbortController();
    const state: BaseRunState = {
      abortController,
      accumulatedInputTokens: 0,
      accumulatedOutputTokens: 0,
      accumulatedCacheReadInputTokens: 0,
      accumulatedCacheCreationInputTokens: 0,
      messageCount: 0,
      timeout: options.timeoutMs,
      maxTurns: options.maxTurns,
    };
    this.runningStates.set(runId, state);

    // Timeout handling (skip if no timeout configured)
    let timedOut = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          state.stoppedReason = 'timeout';
          abortController.abort();
        }, options.timeoutMs)
      : undefined;

    // Result text buffer
    let resultText = '';
    const emit = (chunk: string) => {
      resultText += chunk;
      onOutput?.(chunk);
    };
    const stream = (chunk: string) => {
      onOutput?.(chunk);
    };

    // Build sandbox guard
    const sandboxGuard = new SandboxGuard(options.allowedPaths, options.readOnlyPaths);
    let sandboxGuardCallCount = 0;

    // Build unified permission chain: sandbox guard → callerCanUseTool → onPermissionRequest
    const callerCanUseTool = options.canUseTool;
    const canUseTool: CanUseToolCallback = async (toolName, input, sdkOptions) => {
      sandboxGuardCallCount++;
      // 1. Sandbox guard (synchronous path check)
      const guardResult = sandboxGuard.evaluateToolCall(toolName, input);
      if (!guardResult.allow) {
        log(`Sandbox guard BLOCKED ${toolName}: ${guardResult.reason}`, { callCount: sandboxGuardCallCount });
        return { behavior: 'deny', message: guardResult.reason ?? 'Blocked by sandbox guard' };
      }
      // 2. Caller's canUseTool interceptor (e.g. AskUserQuestion handler)
      let updatedInput: Record<string, unknown> | undefined;
      if (callerCanUseTool) {
        try {
          const callerResult = await callerCanUseTool(toolName, input);
          if (callerResult.behavior === 'deny') {
            return callerResult;
          }
          if (callerResult.behavior === 'allow' && callerResult.updatedInput) {
            updatedInput = callerResult.updatedInput;
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          log(`callerCanUseTool failed for ${toolName}, denying: ${errMsg}`);
          return { behavior: 'deny', message: `Tool interceptor failed: ${errMsg}` };
        }
      }
      // 3. Interactive permission approval (surfaces tool call to UI)
      if (onPermissionRequest) {
        try {
          const effectiveInput = updatedInput ?? input;
          const response = await onPermissionRequest({ toolName, toolInput: effectiveInput, toolUseId: sdkOptions.toolUseID });
          if (response.allowed) {
            return { behavior: 'allow', updatedInput: updatedInput ?? input };
          }
          return { behavior: 'deny', message: 'Denied by user' };
        } catch (err) {
          if (sdkOptions.signal.aborted) {
            return { behavior: 'deny', message: 'Agent was stopped' };
          }
          const errMsg = err instanceof Error ? err.message : String(err);
          log(`onPermissionRequest failed for ${toolName}, denying: ${errMsg}`);
          return { behavior: 'deny', message: `Permission check failed: ${errMsg}` };
        }
      }
      return { behavior: 'allow', updatedInput: updatedInput ?? input };
    };

    log(`Starting agent run: cwd=${options.cwd}, allowedPaths=${JSON.stringify(options.allowedPaths)}, timeout=${options.timeoutMs ? `${options.timeoutMs}ms` : 'none'}, model=${options.model ?? 'default'}, engine=${this.name}`);

    try {
      const engineResult = await this.runEngine(runId, state, {
        prompt: options.prompt,
        options,
        callbacks,
        canUseTool,
        hooks: features.hooks ? options.hooks : undefined,
        log,
        emit,
        stream,
        getResultLength: () => resultText.length,
        enableStreamingInput: options.enableStreamingInput,
      });

      // Warn if sandbox guard was never invoked — canUseTool may be bypassed by the SDK
      if (sandboxGuardCallCount === 0 && state.messageCount > 0) {
        log(`WARNING: Sandbox guard was NEVER called during ${state.messageCount} messages — canUseTool may be bypassed by SDK permissionMode`);
      } else {
        log(`Sandbox guard was invoked ${sandboxGuardCallCount} times during execution`);
      }

      // Merge engine result with accumulated state
      const output = resultText || engineResult.fallbackOutput || engineResult.errorMessage || '';
      const exitCode = engineResult.isError ? 1 : 0;

      return {
        exitCode,
        output,
        error: engineResult.isError ? engineResult.errorMessage : undefined,
        costInputTokens: engineResult.costInputTokens ?? (state.accumulatedInputTokens > 0 ? state.accumulatedInputTokens : undefined),
        costOutputTokens: engineResult.costOutputTokens ?? (state.accumulatedOutputTokens > 0 ? state.accumulatedOutputTokens : undefined),
        cacheReadInputTokens: engineResult.cacheReadInputTokens ?? (state.accumulatedCacheReadInputTokens > 0 ? state.accumulatedCacheReadInputTokens : undefined),
        cacheCreationInputTokens: engineResult.cacheCreationInputTokens ?? (state.accumulatedCacheCreationInputTokens > 0 ? state.accumulatedCacheCreationInputTokens : undefined),
        totalCostUsd: engineResult.totalCostUsd,
        lastContextInputTokens: engineResult.lastContextInputTokens,
        model: options.model ?? this.getDefaultModel(),
        structuredOutput: engineResult.structuredOutput,
        killReason: engineResult.killReason,
        rawExitCode: engineResult.rawExitCode ?? exitCode,
        contextWindow: engineResult.contextWindow,
        maxOutputTokens: engineResult.maxOutputTokens,
        durationMs: engineResult.durationMs,
        durationApiMs: engineResult.durationApiMs,
        numTurns: engineResult.numTurns,
        modelUsage: engineResult.modelUsage,
      };
    } catch (err) {
      // Unexpected error from runEngine (shouldn't happen — engines should catch internally)
      const baseMessage = err instanceof Error ? err.message : String(err);
      let errorMessage: string;
      let killReason: string | undefined;

      if (timedOut) {
        killReason = 'timeout';
        errorMessage = `Agent timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s`;
      } else if (abortController.signal.aborted) {
        killReason = state.stoppedReason ?? 'stopped';
        errorMessage = `Agent aborted [kill_reason=${killReason}]`;
      } else {
        errorMessage = baseMessage;
      }

      log('Agent execution error (uncaught from engine)', { error: baseMessage, timedOut, killReason });

      return {
        exitCode: 1,
        output: resultText || errorMessage,
        error: errorMessage,
        costInputTokens: state.accumulatedInputTokens > 0 ? state.accumulatedInputTokens : undefined,
        costOutputTokens: state.accumulatedOutputTokens > 0 ? state.accumulatedOutputTokens : undefined,
        model: options.model ?? this.getDefaultModel(),
        killReason,
      };
    } finally {
      clearTimeout(timer);
      this.runningStates.delete(runId);
    }
  }

  async stop(runId: string): Promise<void> {
    const state = this.runningStates.get(runId);
    if (!state) {
      getAppLogger().warn(this.name, `stop called for unknown runId: ${runId}`);
      return;
    }
    this.doStop(runId, state);
  }

  /**
   * Inject a user message into a running agent session.
   * Default implementation returns false (not supported).
   * Override in engines that support streaming input (e.g. ClaudeCodeLib).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  injectMessage(_runId: string, _message: string, _images?: Array<{ base64: string; mediaType: string }>): boolean {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async *query(_prompt: string, _options?: { model?: string; maxTokens?: number }): AsyncIterable<QueryEvent> {
    throw new Error(`query() is not implemented for engine: ${this.name}`);
  }

  // ============================================
  // Utility: session history fallback for non-native-resume engines
  // ============================================

  /**
   * Prepend prior session history to the prompt for engines that don't support native resume.
   * Returns the modified prompt, or the original prompt if no history is available.
   * Engines call this in their runEngine() when they need prompt-based resume.
   */
  protected async resolveSessionPrompt(
    prompt: string,
    options: AgentLibRunOptions,
    log: (msg: string, data?: Record<string, unknown>) => void,
  ): Promise<string> {
    if (!options.resumeSession || !this.sessionHistoryProvider || !options.taskId || !options.agentType) {
      return prompt;
    }
    try {
      const prevMessages = await this.sessionHistoryProvider.getPreviousMessages(options.taskId, options.agentType);
      if (prevMessages && prevMessages.length > 0) {
        const history = SessionHistoryFormatter.format(prevMessages);
        log('Session history prepended to prompt (non-native resume fallback)', { messageCount: prevMessages.length, historyLength: history.length });
        return history + '\n\n---\n\n' + prompt;
      }
    } catch (err) {
      log(`Failed to load session history (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
    return prompt;
  }

  // ============================================
  // Utility: build diagnostics string for error reporting
  // ============================================

  protected buildDiagnostics(
    state: BaseRunState,
    options: AgentLibRunOptions,
    extra: Record<string, unknown> = {},
  ): string {
    return [
      ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
      `messages_processed: ${state.messageCount}`,
      `cwd: ${options.cwd}`,
      `model: ${options.model ?? 'default'}`,
      `max_turns: ${options.maxTurns}`,
      `timeout: ${options.timeoutMs ? `${Math.round(options.timeoutMs / 1000)}s` : 'none'}`,
      ...(options.resumeSession ? [`resume_session: ${options.sessionId}`] : []),
      `accumulated_tokens: ${state.accumulatedInputTokens}/${state.accumulatedOutputTokens}`,
    ].join('\n');
  }
}
