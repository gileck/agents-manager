import * as fs from 'fs/promises';
import type { AgentLibFeatures, AgentLibModelOption, QueryEvent } from '../interfaces/agent-lib';
import { getShellEnv } from '../services/shell-env';
import { BaseAgentLib, type BaseRunState, type EngineRunOptions, type EngineResult } from './base-agent-lib';
import { resolveSandboxMode, type SandboxMode } from './codex-lib-utils';
import { writeImagesToTempDir } from './image-utils';

// Use Function constructor to preserve dynamic import() at runtime.
// TypeScript compiles `await import(...)` to `require()` under CommonJS,
// but the SDK is ESM-only. This bypasses that transformation.
const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

// ============================================
// Codex SDK types (engine-specific)
// ============================================

type CodexInput = string | CodexUserInput[];
type CodexUserInput = { type: 'text'; text: string } | { type: 'local_image'; path: string };

interface CodexThreadLike {
  readonly id?: string | null;
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
  resumeThread(id: string, options?: {
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

interface CodexThreadStartedEvent {
  type: 'thread.started';
  thread_id: string;
}

type CodexThreadEvent =
  | CodexThreadStartedEvent
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

// ============================================
// CodexCliLib — Codex SDK engine
// ============================================

export class CodexCliLib extends BaseAgentLib {
  readonly name = 'codex-cli';

  /** Maps our external session key to the SDK's real thread id for in-process native resume. */
  private sdkThreadIds = new Map<string, string>();

  supportedFeatures(): AgentLibFeatures {
    return { images: true, hooks: false, thinking: true, nativeResume: false, streamingInput: false };
  }

  getDefaultModel(): string { return 'gpt-5.4'; }

  getSupportedModels(): AgentLibModelOption[] {
    return [
      { value: 'gpt-5.4', label: 'GPT-5.4' },
      { value: 'gpt-5.4-2026-03-05', label: 'GPT-5.4 (2026-03-05 snapshot)' },
      { value: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
      { value: 'gpt-5.4-pro-2026-03-05', label: 'GPT-5.4 Pro (2026-03-05 snapshot)' },
      { value: 'codex-mini-latest', label: 'Codex Mini Latest' },
      { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex (Legacy)' },
      { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex (Legacy)' },
      { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex (Legacy)' },
      { value: 'gpt-5-codex', label: 'GPT-5 Codex (Legacy)' },
    ];
  }

  async isAvailable(): Promise<boolean> {
    const Codex = await this.tryLoadCodexConstructor();
    return !!Codex;
  }

  /**
   * One-shot query for summarization or session naming.
   * Starts a throw-away thread, runs the prompt, and yields QueryTextEvent / QueryResultEvent.
   */
  async *query(prompt: string, options?: { model?: string; maxTokens?: number }): AsyncIterable<QueryEvent> {
    const Codex = await this.tryLoadCodexConstructor();
    if (!Codex) {
      throw new Error('Codex SDK not available. Install @openai/codex-sdk.');
    }

    const shellEnv = getShellEnv();
    const env = Object.fromEntries(
      Object.entries(shellEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );

    const codex = new Codex({ env });
    const thread = codex.startThread({
      model: options?.model,
      skipGitRepoCheck: true,
    });

    const { events } = await thread.runStreamed(prompt);

    for await (const event of events) {
      if (event.type === 'turn.completed') {
        const usage = (event as CodexThreadTurnCompletedEvent).usage;
        yield {
          type: 'result',
          usage: {
            input_tokens: usage.input_tokens + usage.cached_input_tokens,
            output_tokens: usage.output_tokens,
            cache_read_input_tokens: usage.cached_input_tokens,
          },
        };
        continue;
      }

      if (event.type === 'turn.failed') {
        const fail = event as CodexThreadTurnFailedEvent;
        throw new Error(fail.error?.message ?? 'Codex turn failed');
      }

      if (event.type === 'error') {
        const errEvent = event as CodexThreadErrorEvent;
        throw new Error(errEvent.message);
      }

      if (event.type === 'item.completed') {
        const item = (event as CodexThreadItemEvent).item;
        if (item.type === 'agent_message') {
          yield { type: 'text', text: item.text };
        }
      }
    }
  }

  protected async runEngine(
    runId: string,
    state: BaseRunState,
    engineOpts: EngineRunOptions,
  ): Promise<EngineResult> {
    const { options, callbacks, log, emit, stream } = engineOpts;
    const { onMessage } = callbacks;

    // Session resume: try in-memory thread ID first (native), then prompt replay fallback
    const nativeResumeThreadId = options.resumeSession && options.sessionId
      ? this.sdkThreadIds.get(options.sessionId)
      : undefined;

    let effectivePrompt = engineOpts.prompt;
    if (nativeResumeThreadId) {
      log('Resuming Codex SDK thread from in-memory mapping', {
        sessionId: options.sessionId,
        threadId: nativeResumeThreadId,
      });
    } else {
      // Fall back to prompt replay when we do not have a live SDK thread id
      effectivePrompt = await this.resolveSessionPrompt(engineOpts.prompt, options, log);
    }

    const Codex = await this.tryLoadCodexConstructor();
    if (!Codex) {
      const sdkError = 'Codex SDK not available. Install @openai/codex-sdk.';
      log(sdkError);
      return { isError: true, errorMessage: sdkError };
    }

    const shellEnv = getShellEnv();
    const env = Object.fromEntries(
      Object.entries(shellEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    const sandboxMode = resolveSandboxMode(options.permissionMode, options.readOnly);
    const { input: sdkInput, imageTempDir } = await this.buildSdkInput(runId, effectivePrompt, options.images);
    const additionalDirectories = Array.from(new Set([
      ...options.allowedPaths.filter(Boolean),
      ...(imageTempDir ? [imageTempDir] : []),
    ]));

    const threadOptions = {
      model: options.model,
      sandboxMode,
      workingDirectory: options.cwd,
      skipGitRepoCheck: true,
      approvalPolicy: 'never' as const,
      ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
    };
    const codex = new Codex({ env });
    const thread = nativeResumeThreadId
      ? codex.resumeThread(nativeResumeThreadId, threadOptions)
      : codex.startThread(threadOptions);

    log('Starting Codex SDK run', {
      cwd: options.cwd,
      model: options.model ?? this.getDefaultModel(),
      timeoutMs: options.timeoutMs,
      maxTurns: options.maxTurns,
      sandboxMode,
      hasOutputSchema: !!options.outputFormat,
      resumeThreadId: nativeResumeThreadId,
    });

    let finalAssistantText = '';
    let structuredOutput: Record<string, unknown> | undefined;
    let isError = false;
    let errorMessage: string | undefined;
    let killReason: string | undefined;
    let activeThreadId = nativeResumeThreadId ?? thread.id ?? undefined;

    const assistantSnapshots = new Map<string, string>();
    const commandOutputOffsets = new Map<string, number>();
    const emittedToolUse = new Set<string>();

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
          signal: state.abortController.signal,
        },
      );

      for await (const event of events) {
        state.messageCount++;

        if (event.type === 'thread.started') {
          const started = event as CodexThreadStartedEvent;
          activeThreadId = started.thread_id;
          if (options.sessionId) {
            this.sdkThreadIds.set(options.sessionId, started.thread_id);
          }
          log('Codex SDK thread started', {
            sessionId: options.sessionId,
            threadId: started.thread_id,
          });
          continue;
        }

        if (event.type === 'turn.completed') {
          const usage = (event as CodexThreadTurnCompletedEvent).usage;
          state.accumulatedCacheReadInputTokens = usage.cached_input_tokens;
          state.accumulatedInputTokens = usage.input_tokens + usage.cached_input_tokens;
          state.accumulatedOutputTokens = usage.output_tokens;
          onMessage?.({
            type: 'usage',
            inputTokens: state.accumulatedInputTokens,
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
              emit(delta);
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
                input: item.command,
                timestamp: Date.now(),
              });
              stream(`\n> Tool: bash\n> Input: ${item.command}\n`);
            }

            const previousOffset = commandOutputOffsets.get(item.id) ?? 0;
            const currentOutput = item.aggregated_output ?? '';
            if (currentOutput.length > previousOffset) {
              const diff = currentOutput.slice(previousOffset);
              stream(diff);
              commandOutputOffsets.set(item.id, currentOutput.length);
            }

            if (event.type === 'item.completed') {
              onMessage?.({
                type: 'tool_result',
                toolId: item.id,
                result: item.aggregated_output ?? '',
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
                input: JSON.stringify(item.arguments ?? {}),
                timestamp: Date.now(),
              });
              stream(`\n> Tool: ${item.server}.${item.tool}\n`);
            }

            if (event.type === 'item.completed') {
              if (item.status === 'failed') {
                const msg = item.error?.message ?? 'MCP tool call failed';
                isError = true;
                errorMessage = errorMessage ?? msg;
                onMessage?.({ type: 'tool_result', toolId: item.id, result: msg, timestamp: Date.now() });
              } else {
                const resultTextValue = textFromMcpResult(item.result?.content)
                  || (item.result?.structured_content != null ? JSON.stringify(item.result.structured_content) : '');
                onMessage?.({
                  type: 'tool_result',
                  toolId: item.id,
                  result: resultTextValue,
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
                input: item.query,
                timestamp: Date.now(),
              });
            }
            break;
          }
          case 'todo_list': {
            if (event.type === 'item.completed') {
              const total = item.items.length;
              const done = item.items.filter((entry) => entry.completed).length;
              stream(`\n> Todo: ${done}/${total} completed\n`);
            }
            break;
          }
          case 'file_change': {
            if (event.type === 'item.completed') {
              const summary = item.changes.map((change) => `${change.kind}:${change.path}`).join(', ');
              stream(`\n> File changes: ${summary}\n`);
            }
            break;
          }
          case 'error': {
            isError = true;
            errorMessage = item.message;
            emit(`[error] ${item.message}\n`);
            break;
          }
          default: {
            break;
          }
        }
      }

      if (options.outputFormat) {
        structuredOutput = CodexCliLib.parseStructuredOutput(finalAssistantText);
      }
    } catch (err) {
      isError = true;
      const baseMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      if (state.stoppedReason === 'timeout') {
        killReason = 'timeout';
        errorMessage = `codex-sdk timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s`;
      } else if (state.abortController.signal.aborted) {
        killReason = state.stoppedReason ?? 'stopped';
        errorMessage = `codex-sdk run aborted [kill_reason=${killReason}]`;
      } else {
        const diagnostics = this.buildDiagnostics(state, options, {
          sdk_error: baseMessage,
          ...(errorStack ? { stack: errorStack } : {}),
          cached_input_tokens: state.accumulatedCacheReadInputTokens,
          thread_id: activeThreadId ?? 'unknown',
        });
        errorMessage = `${baseMessage}\n\n--- Diagnostics ---\n${diagnostics}`;
      }
      log('Codex SDK run failed', {
        error: baseMessage,
        stack: errorStack,
        messagesProcessed: state.messageCount,
        cwd: options.cwd,
        model: options.model,
        maxTurns: options.maxTurns,
        timeout: options.timeoutMs,
        accumulatedInputTokens: state.accumulatedInputTokens,
        accumulatedOutputTokens: state.accumulatedOutputTokens,
        accumulatedCacheReadInputTokens: state.accumulatedCacheReadInputTokens,
        aborted: state.abortController.signal.aborted,
        killReason,
        threadId: activeThreadId,
      });
    } finally {
      if (imageTempDir) {
        try {
          await fs.rm(imageTempDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup only.
        }
      }
    }

    return {
      isError,
      errorMessage,
      fallbackOutput: finalAssistantText || undefined,
      killReason,
      rawExitCode: isError ? 1 : 0,
      structuredOutput,
      cacheReadInputTokens: state.accumulatedCacheReadInputTokens || undefined,
    };
  }

  private async tryLoadCodexConstructor(): Promise<CodexConstructor | null> {
    try {
      const mod = await import('@openai/codex-sdk');
      if (typeof mod.Codex === 'function') {
        return mod.Codex as CodexConstructor;
      }
    } catch {
      // Fall through to importESM below.
    }
    try {
      const mod = await importESM('@openai/codex-sdk');
      if (typeof mod.Codex !== 'function') return null;
      return mod.Codex as CodexConstructor;
    } catch {
      return null;
    }
  }

  private static parseStructuredOutput(text: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Best effort parse only
    }
    return undefined;
  }

  private async buildSdkInput(
    runId: string,
    prompt: string,
    images?: Array<{ base64: string; mediaType: string }>,
  ): Promise<{ input: CodexInput; imageTempDir?: string }> {
    if (!images || images.length === 0) {
      return { input: prompt };
    }

    const { tempDir, filePaths } = await writeImagesToTempDir(runId, 'agents-manager-codex', images);
    const input: CodexUserInput[] = [
      { type: 'text', text: prompt },
      ...filePaths.map((filePath) => ({ type: 'local_image' as const, path: filePath })),
    ];
    return { input, imageTempDir: tempDir };
  }
}
