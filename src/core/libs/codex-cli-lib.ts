import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { IAgentLib, AgentLibRunOptions, AgentLibCallbacks, AgentLibResult, AgentLibTelemetry, AgentLibModelOption } from '../interfaces/agent-lib';
import type { ISessionHistoryProvider } from '../interfaces/session-history-provider';
import { SessionHistoryFormatter } from '../services/session-history-formatter';
import { getShellEnv } from '../services/shell-env';
import { getAppLogger } from '../services/app-logger';

// Use Function constructor to preserve dynamic import() at runtime.
// TypeScript compiles `await import(...)` to `require()` under CommonJS,
// but the SDK is ESM-only. This bypasses that transformation.
const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

type SandboxMode = 'read-only' | 'workspace-write';
type CodexInput = string | CodexUserInput[];
type CodexUserInput = { type: 'text'; text: string } | { type: 'local_image'; path: string };

interface CodexThreadLike {
  runStreamed(input: CodexInput, options?: { outputSchema?: unknown; signal?: AbortSignal }): Promise<{ events: AsyncIterable<CodexThreadEvent> }>;
}

interface CodexLike {
  startThread(options?: {
    model?: string;
    sandboxMode?: SandboxMode;
    workingDirectory?: string;
    skipGitRepoCheck?: boolean;
    approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
    additionalDirectories?: string[];
  }): CodexThreadLike;
}

type CodexConstructor = new (options?: {
  env?: Record<string, string>;
}) => CodexLike;

interface CodexThreadTurnCompletedEvent {
  type: 'turn.completed';
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  };
}

interface CodexThreadTurnFailedEvent {
  type: 'turn.failed';
  error: { message: string };
}

interface CodexThreadErrorEvent {
  type: 'error';
  message: string;
}

interface CodexThreadItemEvent {
  type: 'item.started' | 'item.updated' | 'item.completed';
  item: CodexThreadItem;
}

type CodexThreadEvent =
  | CodexThreadTurnCompletedEvent
  | CodexThreadTurnFailedEvent
  | CodexThreadErrorEvent
  | CodexThreadItemEvent
  | { type: string };

type CodexThreadItem =
  | { id: string; type: 'agent_message'; text: string }
  | { id: string; type: 'reasoning'; text: string }
  | { id: string; type: 'command_execution'; command: string; aggregated_output: string; status: 'in_progress' | 'completed' | 'failed'; exit_code?: number }
  | { id: string; type: 'mcp_tool_call'; server: string; tool: string; arguments: unknown; status: 'in_progress' | 'completed' | 'failed'; result?: { content?: unknown[]; structured_content?: unknown }; error?: { message: string } }
  | { id: string; type: 'web_search'; query: string }
  | { id: string; type: 'todo_list'; items: Array<{ text: string; completed: boolean }> }
  | { id: string; type: 'file_change'; changes: Array<{ path: string; kind: 'add' | 'delete' | 'update' }>; status: 'completed' | 'failed' }
  | { id: string; type: 'error'; message: string };

interface RunState {
  abortController: AbortController;
  messageCount: number;
  accumulatedInputTokens: number;
  accumulatedOutputTokens: number;
  timeout: number;
  maxTurns: number;
  stoppedReason?: string;
}

export class CodexCliLib implements IAgentLib {
  readonly name = 'codex-cli';

  private runningStates = new Map<string, RunState>();
  /** Tracks why a run was stopped, survives the stop() -> completion gap. */
  private stoppedReasons = new Map<string, string>();

  constructor(private sessionHistoryProvider?: ISessionHistoryProvider) {}

  supportedFeatures() {
    return {
      images: true,
      hooks: false,
      thinking: true,
      nativeResume: false,
    };
  }

  getDefaultModel(): string { return 'gpt-5.3-codex'; }

  getSupportedModels(): AgentLibModelOption[] {
    return [
      { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
      { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
      { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
      { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
      { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
    ];
  }

  async isAvailable(): Promise<boolean> {
    const Codex = await this.tryLoadCodexConstructor();
    return !!Codex;
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
    const { onLog } = callbacks;
    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);

    // Session resume: prepend prior session history to the prompt
    if (options.resumeSession && this.sessionHistoryProvider && options.taskId && options.agentType) {
      try {
        const prevMessages = await this.sessionHistoryProvider.getPreviousMessages(options.taskId, options.agentType);
        if (prevMessages && prevMessages.length > 0) {
          const history = SessionHistoryFormatter.format(prevMessages);
          options = { ...options, prompt: history + '\n\n---\n\n' + options.prompt };
          log('Session history prepended to prompt', { messageCount: prevMessages.length, historyLength: history.length });
        }
      } catch (err) {
        log(`Failed to load session history (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const Codex = await this.tryLoadCodexConstructor();
    if (Codex) {
      return this.executeWithSdk(Codex, runId, options, callbacks);
    }

    const sdkError = 'Codex SDK not available. Install @openai/codex-sdk.';
    log(sdkError);
    return {
      exitCode: 1,
      output: sdkError,
      error: sdkError,
      model: options.model ?? this.getDefaultModel(),
    };
  }

  async stop(runId: string): Promise<void> {
    const state = this.runningStates.get(runId);
    if (!state) {
      getAppLogger().warn('CodexCliLib', `stop called for unknown runId: ${runId}`);
      return;
    }

    this.stoppedReasons.set(runId, 'stopped');
    state.stoppedReason = 'stopped';

    state.abortController.abort();
  }

  private async executeWithSdk(
    Codex: CodexConstructor,
    runId: string,
    options: AgentLibRunOptions,
    callbacks: AgentLibCallbacks,
  ): Promise<AgentLibResult> {
    const { onOutput, onLog, onMessage } = callbacks;
    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);

    const abortController = new AbortController();
    const state: RunState = {
      abortController,
      messageCount: 0,
      accumulatedInputTokens: 0,
      accumulatedOutputTokens: 0,
      timeout: options.timeoutMs,
      maxTurns: options.maxTurns,
    };
    this.runningStates.set(runId, state);

    const shellEnv = getShellEnv();
    const env = Object.fromEntries(
      Object.entries(shellEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    const sandboxMode: SandboxMode = options.readOnly ? 'read-only' : 'workspace-write';
    const { input: sdkInput, imageTempDir } = await this.buildSdkInput(runId, options.prompt, options.images);
    const additionalDirectories = Array.from(new Set([
      ...options.allowedPaths.filter(Boolean),
      ...(imageTempDir ? [imageTempDir] : []),
    ]));

    const codex = new Codex({ env });
    const thread = codex.startThread({
      model: options.model,
      sandboxMode,
      workingDirectory: options.cwd,
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
      ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
    });

    log('Starting Codex SDK run', {
      cwd: options.cwd,
      model: options.model ?? this.getDefaultModel(),
      timeoutMs: options.timeoutMs,
      maxTurns: options.maxTurns,
      sandboxMode,
      hasOutputSchema: !!options.outputFormat,
    });

    let resultText = '';
    let finalAssistantText = '';
    let structuredOutput: Record<string, unknown> | undefined;
    let isError = false;
    let errorMessage: string | undefined;
    let killReason: string | undefined;

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.stoppedReasons.set(runId, 'timeout');
      state.stoppedReason = 'timeout';
      abortController.abort();
    }, options.timeoutMs);

    const assistantSnapshots = new Map<string, string>();
    const commandOutputOffsets = new Map<string, number>();
    const emittedToolUse = new Set<string>();

    const appendPersistentOutput = (chunk: string): void => {
      if (!chunk) return;
      resultText += chunk;
      onOutput?.(chunk);
    };

    const emitStreamOnly = (chunk: string): void => {
      if (!chunk) return;
      onOutput?.(chunk);
    };

    const parseStructuredOutput = (text: string): Record<string, unknown> | undefined => {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Best effort parse only
      }
      return undefined;
    };

    const textFromMcpResult = (content?: unknown[]): string => {
      if (!Array.isArray(content)) return '';
      const chunks: string[] = [];
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const asText = part as { type?: string; text?: unknown };
        if (asText.type === 'text' && typeof asText.text === 'string') {
          chunks.push(asText.text);
        }
      }
      return chunks.join('\n');
    };

    try {
      const { events } = await thread.runStreamed(
        sdkInput,
        {
          ...(options.outputFormat ? { outputSchema: options.outputFormat } : {}),
          signal: abortController.signal,
        },
      );

      for await (const event of events) {
        state.messageCount++;

        if (event.type === 'turn.completed') {
          const usage = (event as CodexThreadTurnCompletedEvent).usage;
          state.accumulatedInputTokens = usage.input_tokens;
          state.accumulatedOutputTokens = usage.output_tokens;
          onMessage?.({
            type: 'usage',
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            timestamp: Date.now(),
          });
          continue;
        }

        if (event.type === 'turn.failed') {
          const fail = event as CodexThreadTurnFailedEvent;
          isError = true;
          errorMessage = fail.error?.message ?? 'Codex turn failed';
          continue;
        }

        if (event.type === 'error') {
          const errEvent = event as CodexThreadErrorEvent;
          isError = true;
          errorMessage = errEvent.message;
          continue;
        }

        if (event.type !== 'item.started' && event.type !== 'item.updated' && event.type !== 'item.completed') {
          continue;
        }

        const item = (event as CodexThreadItemEvent).item;
        switch (item.type) {
          case 'agent_message': {
            const prevText = assistantSnapshots.get(item.id) ?? '';
            const nextText = item.text ?? '';
            const delta = nextText.startsWith(prevText) ? nextText.slice(prevText.length) : nextText;
            if (delta) {
              appendPersistentOutput(delta);
              onMessage?.({ type: 'assistant_text', text: delta, timestamp: Date.now() });
            }
            assistantSnapshots.set(item.id, nextText);
            finalAssistantText = nextText;
            break;
          }
          case 'reasoning': {
            onMessage?.({ type: 'thinking', text: item.text, timestamp: Date.now() });
            break;
          }
          case 'command_execution': {
            if (!emittedToolUse.has(item.id)) {
              emittedToolUse.add(item.id);
              onMessage?.({
                type: 'tool_use',
                toolName: 'bash',
                toolId: item.id,
                input: item.command.slice(0, 2000),
                timestamp: Date.now(),
              });
              emitStreamOnly(`\n> Tool: bash\n> Input: ${item.command}\n`);
            }

            const previousOffset = commandOutputOffsets.get(item.id) ?? 0;
            const currentOutput = item.aggregated_output ?? '';
            if (currentOutput.length > previousOffset) {
              const diff = currentOutput.slice(previousOffset);
              emitStreamOnly(diff);
              commandOutputOffsets.set(item.id, currentOutput.length);
            }

            if (event.type === 'item.completed') {
              onMessage?.({
                type: 'tool_result',
                toolId: item.id,
                result: (item.aggregated_output ?? '').slice(0, 2000),
                timestamp: Date.now(),
              });
            }
            break;
          }
          case 'mcp_tool_call': {
            if (!emittedToolUse.has(item.id)) {
              emittedToolUse.add(item.id);
              onMessage?.({
                type: 'tool_use',
                toolName: `${item.server}.${item.tool}`,
                toolId: item.id,
                input: JSON.stringify(item.arguments ?? {}).slice(0, 2000),
                timestamp: Date.now(),
              });
              emitStreamOnly(`\n> Tool: ${item.server}.${item.tool}\n`);
            }

            if (event.type === 'item.completed') {
              if (item.status === 'failed') {
                const msg = item.error?.message ?? 'MCP tool call failed';
                isError = true;
                errorMessage = errorMessage ?? msg;
                onMessage?.({ type: 'tool_result', toolId: item.id, result: msg.slice(0, 2000), timestamp: Date.now() });
              } else {
                const resultTextValue = textFromMcpResult(item.result?.content)
                  || (item.result?.structured_content != null ? JSON.stringify(item.result.structured_content) : '');
                onMessage?.({
                  type: 'tool_result',
                  toolId: item.id,
                  result: resultTextValue.slice(0, 2000),
                  timestamp: Date.now(),
                });
              }
            }
            break;
          }
          case 'web_search': {
            if (!emittedToolUse.has(item.id)) {
              emittedToolUse.add(item.id);
              onMessage?.({
                type: 'tool_use',
                toolName: 'web_search',
                toolId: item.id,
                input: item.query.slice(0, 2000),
                timestamp: Date.now(),
              });
            }
            break;
          }
          case 'todo_list': {
            if (event.type === 'item.completed') {
              const total = item.items.length;
              const done = item.items.filter((entry) => entry.completed).length;
              emitStreamOnly(`\n> Todo: ${done}/${total} completed\n`);
            }
            break;
          }
          case 'file_change': {
            if (event.type === 'item.completed') {
              const summary = item.changes.map((change) => `${change.kind}:${change.path}`).join(', ');
              emitStreamOnly(`\n> File changes: ${summary}\n`);
            }
            break;
          }
          case 'error': {
            isError = true;
            errorMessage = item.message;
            appendPersistentOutput(`[error] ${item.message}\n`);
            break;
          }
          default: {
            break;
          }
        }
      }

      if (options.outputFormat) {
        structuredOutput = parseStructuredOutput(finalAssistantText);
      }
    } catch (err) {
      isError = true;
      const baseMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      if (timedOut) {
        killReason = 'timeout';
        errorMessage = `codex-sdk timed out after ${Math.round(options.timeoutMs / 1000)}s`;
      } else if (abortController.signal.aborted) {
        killReason = this.stoppedReasons.get(runId) ?? state.stoppedReason ?? 'stopped';
        errorMessage = `codex-sdk run aborted [kill_reason=${killReason}]`;
      } else {
        // Include diagnostics for unexpected failures
        const diagnostics = [
          `sdk_error: ${baseMessage}`,
          ...(errorStack ? [`stack: ${errorStack}`] : []),
          `messages_processed: ${state.messageCount}`,
          `cwd: ${options.cwd}`,
          `model: ${options.model ?? 'default'}`,
          `max_turns: ${options.maxTurns}`,
          `timeout: ${Math.round(options.timeoutMs / 1000)}s`,
          `accumulated_tokens: ${state.accumulatedInputTokens}/${state.accumulatedOutputTokens}`,
          `result_text_length: ${resultText.length}`,
        ].join('\n');
        errorMessage = `${baseMessage}\n\n--- Diagnostics ---\n${diagnostics}`;
      }
      log(`Codex SDK run failed`, {
        error: baseMessage,
        stack: errorStack,
        messagesProcessed: state.messageCount,
        cwd: options.cwd,
        model: options.model,
        maxTurns: options.maxTurns,
        timeout: options.timeoutMs,
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
      this.stoppedReasons.delete(runId);
      if (imageTempDir) {
        try {
          await fs.rm(imageTempDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup only.
        }
      }
    }

    const output = resultText || finalAssistantText || errorMessage || '';
    const exitCode = isError ? 1 : 0;
    return {
      exitCode,
      output,
      error: isError ? errorMessage : undefined,
      costInputTokens: state.accumulatedInputTokens || undefined,
      costOutputTokens: state.accumulatedOutputTokens || undefined,
      model: options.model ?? this.getDefaultModel(),
      structuredOutput,
      killReason,
      rawExitCode: exitCode,
    };
  }

  private async tryLoadCodexConstructor(): Promise<CodexConstructor | null> {
    // Try native dynamic import first. In vitest/Vite this is usually supported,
    // while production CommonJS builds may rewrite it to require().
    try {
      const mod = await import('@openai/codex-sdk');
      if (typeof mod.Codex === 'function') {
        return mod.Codex as CodexConstructor;
      }
    } catch {
      // Fall through to importESM below.
    }

    // Fallback for CommonJS builds: preserve true dynamic import at runtime.
    try {
      const mod = await importESM('@openai/codex-sdk');
      if (typeof mod.Codex !== 'function') return null;
      return mod.Codex as CodexConstructor;
    } catch {
      return null;
    }
  }

  private mediaTypeToExtension(mediaType: string): string {
    switch (mediaType) {
      case 'image/png':
        return 'png';
      case 'image/jpeg':
        return 'jpg';
      case 'image/gif':
        return 'gif';
      case 'image/webp':
        return 'webp';
      default:
        return 'img';
    }
  }

  private normalizeBase64(base64: string): string {
    const marker = 'base64,';
    const idx = base64.indexOf(marker);
    return idx >= 0 ? base64.slice(idx + marker.length) : base64;
  }

  private async buildSdkInput(
    runId: string,
    prompt: string,
    images?: Array<{ base64: string; mediaType: string }>,
  ): Promise<{ input: CodexInput; imageTempDir?: string }> {
    if (!images || images.length === 0) {
      return { input: prompt };
    }

    const imageTempDir = await fs.mkdtemp(path.join(os.tmpdir(), `agents-manager-codex-${runId}-`));
    const input: CodexUserInput[] = [{ type: 'text', text: prompt }];

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const ext = this.mediaTypeToExtension(img.mediaType);
      const filePath = path.join(imageTempDir, `image-${i + 1}.${ext}`);
      const normalized = this.normalizeBase64(img.base64);
      const bytes = Buffer.from(normalized, 'base64');
      await fs.writeFile(filePath, bytes);
      input.push({ type: 'local_image', path: filePath });
    }

    return { input, imageTempDir };
  }
}
