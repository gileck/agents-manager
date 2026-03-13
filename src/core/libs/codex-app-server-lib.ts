import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentLibFeatures, AgentLibModelOption } from '../interfaces/agent-lib';
import type { ISessionHistoryProvider } from '../interfaces/session-history-provider';
import { BaseAgentLib, type BaseRunState, type EngineResult, type EngineRunOptions } from './base-agent-lib';
import {
  CodexAppServerClient,
  type CodexAppServerClientOptions,
  type CodexAppServerNotification,
  type CodexAppServerServerRequest,
  type CodexAppServerThreadInfo,
} from './codex-app-server-client';
import { getShellEnv } from '../services/shell-env';

type CodexAppServerClientFactory = (options: CodexAppServerClientOptions) => CodexAppServerClient;

interface CodexAppServerLibOptions {
  sessionMapPath?: string;
}

interface ActiveRun {
  client: CodexAppServerClient;
  threadId?: string;
  turnId?: string;
  interrupted: boolean;
}

type CodexThreadItem =
  | { type: 'commandExecution'; id: string; command: string; aggregatedOutput: string | null; status?: string; cwd?: string }
  | { type: 'mcpToolCall'; id: string; server: string; tool: string; arguments: unknown; result: { content?: unknown[]; structuredContent?: unknown } | null; error?: { message?: string | null } | null }
  | { type: 'webSearch'; id: string; query: string }
  | { type: 'agentMessage'; id: string; text: string }
  | { type: 'reasoning'; id: string; summary?: string[]; content?: string[] }
  | { type: string; id: string };

const DEFAULT_SESSION_MAP_PATH = path.join(os.homedir(), '.agents-manager', 'codex-app-server-thread-map.json');

type PersistedThreadMap = Record<string, { threadId: string; updatedAt: number }>;

export class CodexAppServerLib extends BaseAgentLib {
  readonly name = 'codex-app-server';

  private readonly sessionThreadIds = new Map<string, string>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly sessionMapPath: string;

  constructor(
    sessionHistoryProvider?: ISessionHistoryProvider,
    private readonly createClient: CodexAppServerClientFactory = (options) => new CodexAppServerClient(options),
    libOptions: CodexAppServerLibOptions = {},
  ) {
    super(sessionHistoryProvider);
    this.sessionMapPath = libOptions.sessionMapPath ?? process.env.AM_CODEX_APP_SERVER_SESSION_MAP_PATH ?? DEFAULT_SESSION_MAP_PATH;
    this.loadPersistedSessionThreadIds();
  }

  supportedFeatures(): AgentLibFeatures {
    return {
      images: false,
      hooks: false,
      thinking: true,
      nativeResume: true,
    };
  }

  getDefaultModel(): string { return 'gpt-5.4'; }

  getSupportedModels(): AgentLibModelOption[] {
    return [
      { value: 'gpt-5.4', label: 'GPT-5.4' },
      { value: 'gpt-5.4-2026-03-05', label: 'GPT-5.4 (2026-03-05 snapshot)' },
      { value: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
      { value: 'gpt-5.4-pro-2026-03-05', label: 'GPT-5.4 Pro (2026-03-05 snapshot)' },
      { value: 'codex-mini-latest', label: 'Codex Mini Latest' },
    ];
  }

  async isAvailable(): Promise<boolean> {
    const client = this.createClient({
      clientInfo: { name: 'agents-manager', version: '0.0.0' },
    });
    try {
      await client.start();
      return true;
    } catch {
      return false;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  protected override doStop(runId: string, state: BaseRunState): void {
    state.stoppedReason = 'stopped';
    state.abortController.abort();
  }

  protected async runEngine(
    runId: string,
    state: BaseRunState,
    engineOpts: EngineRunOptions,
  ): Promise<EngineResult> {
    const { options, callbacks, prompt, log, emit, stream } = engineOpts;
    const { onMessage, onQuestionRequest, onStreamEvent, onUserToolResult } = callbacks;

    const shellEnv = getShellEnv();
    const env = Object.fromEntries(
      Object.entries(shellEnv).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );

    const resumeThreadId = options.resumeSession && options.sessionId
      ? this.sessionThreadIds.get(options.sessionId)
      : undefined;
    const effectivePrompt = resumeThreadId
      ? prompt
      : await this.resolveSessionPrompt(prompt, options, log);

    let activeRun!: ActiveRun;

    let threadId = resumeThreadId;
    let turnId: string | undefined;
    let finalAssistantText = '';
    let errorMessage: string | undefined;
    let isError = false;
    let killReason: string | undefined;
    let contextWindow: number | undefined;
    let lastContextInputTokens: number | undefined;
    let structuredOutput: Record<string, unknown> | undefined;
    let emittedToolUse = new Set<string>();
    const assistantSnapshots = new Map<string, string>();
    let turnDoneResolve!: () => void;
    const turnDone = new Promise<void>((resolve) => {
      turnDoneResolve = resolve;
    });

    const interruptActiveTurn = async (): Promise<void> => {
      if (activeRun.interrupted) return;
      activeRun.interrupted = true;
      if (activeRun.threadId && activeRun.turnId) {
        try {
          await activeRun.client.turnInterrupt({ threadId: activeRun.threadId, turnId: activeRun.turnId });
        } catch (err) {
          log('Failed to interrupt codex app-server turn', { error: err instanceof Error ? err.message : String(err) });
        }
      }
      setTimeout(() => {
        void activeRun.client.close();
      }, 1000);
    };

    const abortListener = () => {
      void interruptActiveTurn();
    };
    state.abortController.signal.addEventListener('abort', abortListener, { once: true });

    const textFromMcpResult = (content?: unknown[]): string => {
      if (!Array.isArray(content)) return '';
      return content
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return '';
          const record = entry as { type?: string; text?: unknown };
          return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
        })
        .filter(Boolean)
        .join('\n');
    };

    const rememberThread = (thread?: CodexAppServerThreadInfo | null) => {
      if (!thread?.id) return;
      threadId = thread.id;
      activeRun.threadId = thread.id;
      if (options.sessionId) {
        this.rememberSessionThreadId(options.sessionId, thread.id);
      }
    };

    const parseStructuredOutput = (text: string): Record<string, unknown> | undefined => {
      if (!options.outputFormat || !text) return undefined;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Best-effort only.
      }
      return undefined;
    };

    const emitAssistantDelta = (itemId: string, delta: string): void => {
      if (!delta) return;
      finalAssistantText += delta;
      emit(delta);
      onMessage?.({ type: 'assistant_text', text: delta, timestamp: Date.now() });
      onStreamEvent?.({ type: 'content_block_delta', delta: { type: 'text_delta', text: delta } });
      if (itemId) {
        assistantSnapshots.set(itemId, (assistantSnapshots.get(itemId) ?? '') + delta);
      }
    };

    const handleItemStarted = (item: CodexThreadItem): void => {
      switch (item.type) {
        case 'commandExecution': {
          const commandItem = item as Extract<CodexThreadItem, { type: 'commandExecution' }>;
          if (emittedToolUse.has(item.id)) return;
          emittedToolUse.add(item.id);
          onMessage?.({
            type: 'tool_use',
            toolName: 'bash',
            toolId: item.id,
            input: commandItem.command.slice(0, 2000),
            timestamp: Date.now(),
          });
          stream(`\n> Tool: bash\n> Input: ${commandItem.command}\n`);
          break;
        }
        case 'mcpToolCall': {
          const mcpItem = item as Extract<CodexThreadItem, { type: 'mcpToolCall' }>;
          if (emittedToolUse.has(item.id)) return;
          emittedToolUse.add(item.id);
          onMessage?.({
            type: 'tool_use',
            toolName: `${mcpItem.server}.${mcpItem.tool}`,
            toolId: item.id,
            input: JSON.stringify(mcpItem.arguments ?? {}).slice(0, 2000),
            timestamp: Date.now(),
          });
          stream(`\n> Tool: ${mcpItem.server}.${mcpItem.tool}\n`);
          break;
        }
        case 'webSearch': {
          const webSearchItem = item as Extract<CodexThreadItem, { type: 'webSearch' }>;
          if (emittedToolUse.has(item.id)) return;
          emittedToolUse.add(item.id);
          onMessage?.({
            type: 'tool_use',
            toolName: 'web_search',
            toolId: item.id,
            input: webSearchItem.query.slice(0, 2000),
            timestamp: Date.now(),
          });
          break;
        }
        case 'agentMessage': {
          const agentItem = item as Extract<CodexThreadItem, { type: 'agentMessage' }>;
          const previousText = assistantSnapshots.get(item.id) ?? '';
          const nextText = agentItem.text ?? '';
          const delta = nextText.startsWith(previousText) ? nextText.slice(previousText.length) : nextText;
          emitAssistantDelta(item.id, delta);
          assistantSnapshots.set(item.id, nextText);
          break;
        }
        default:
          break;
      }
    };

    const handleItemCompleted = (item: CodexThreadItem): void => {
      switch (item.type) {
        case 'agentMessage': {
          const agentItem = item as Extract<CodexThreadItem, { type: 'agentMessage' }>;
          const previousText = assistantSnapshots.get(item.id) ?? '';
          const nextText = agentItem.text ?? '';
          if (!nextText) break;
          const delta = nextText.startsWith(previousText) ? nextText.slice(previousText.length) : nextText;
          emitAssistantDelta(item.id, delta);
          assistantSnapshots.set(item.id, nextText);
          break;
        }
        case 'commandExecution': {
          const commandItem = item as Extract<CodexThreadItem, { type: 'commandExecution' }>;
          onMessage?.({
            type: 'tool_result',
            toolId: item.id,
            result: (commandItem.aggregatedOutput ?? '').slice(0, 2000),
            timestamp: Date.now(),
          });
          break;
        }
        case 'mcpToolCall': {
          const mcpItem = item as Extract<CodexThreadItem, { type: 'mcpToolCall' }>;
          const resultText = mcpItem.error?.message
            ?? (textFromMcpResult(mcpItem.result?.content) || (mcpItem.result?.structuredContent != null ? JSON.stringify(mcpItem.result.structuredContent) : ''));
          onMessage?.({
            type: 'tool_result',
            toolId: item.id,
            result: resultText.slice(0, 2000),
            timestamp: Date.now(),
          });
          break;
        }
        default:
          break;
      }
    };

    const handleNotification = (notification: CodexAppServerNotification): void => {
      state.messageCount++;
      const params = notification.params;

      switch (notification.method) {
        case 'thread/started':
          rememberThread((params.thread ?? null) as CodexAppServerThreadInfo | null);
          break;
        case 'turn/started': {
          const turn = params.turn as { id?: string } | undefined;
          if (turn?.id) {
            turnId = turn.id;
            activeRun.turnId = turn.id;
          }
          break;
        }
        case 'item/agentMessage/delta': {
          const delta = typeof params.delta === 'string' ? params.delta : '';
          if (!delta) break;
          emitAssistantDelta(typeof params.itemId === 'string' ? params.itemId : '', delta);
          break;
        }
        case 'item/reasoning/textDelta': {
          const delta = typeof params.delta === 'string' ? params.delta : '';
          if (!delta) break;
          onMessage?.({ type: 'thinking', text: delta, timestamp: Date.now() });
          onStreamEvent?.({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: delta } });
          break;
        }
        case 'item/commandExecution/outputDelta': {
          const delta = typeof params.delta === 'string' ? params.delta : '';
          if (delta) stream(delta);
          break;
        }
        case 'item/started':
          handleItemStarted((params.item ?? { type: 'unknown', id: '' }) as CodexThreadItem);
          break;
        case 'item/completed':
          handleItemCompleted((params.item ?? { type: 'unknown', id: '' }) as CodexThreadItem);
          break;
        case 'thread/tokenUsage/updated': {
          const usage = params.tokenUsage as {
            total?: {
              inputTokens?: number;
              cachedInputTokens?: number;
              outputTokens?: number;
            };
            last?: {
              totalTokens?: number;
            };
            modelContextWindow?: number | null;
          } | undefined;
          if (!usage?.total) break;
          state.accumulatedInputTokens = Number(usage.total.inputTokens) || 0;
          state.accumulatedCacheReadInputTokens = Number(usage.total.cachedInputTokens) || 0;
          state.accumulatedOutputTokens = Number(usage.total.outputTokens) || 0;
          contextWindow = usage.modelContextWindow == null ? undefined : usage.modelContextWindow;
          lastContextInputTokens = ((usage.last as { totalTokens?: number } | undefined)?.totalTokens) ?? lastContextInputTokens;
          onMessage?.({
            type: 'usage',
            inputTokens: state.accumulatedInputTokens,
            outputTokens: state.accumulatedOutputTokens,
            lastContextInputTokens,
            timestamp: Date.now(),
          });
          break;
        }
        case 'turn/completed': {
          const turn = params.turn as { id?: string; status?: string; error?: { message?: string | null; additionalDetails?: string | null } | null } | undefined;
          if (turn?.id) {
            turnId = turn.id;
            activeRun.turnId = turn.id;
          }
          if (turn?.status === 'failed') {
            isError = true;
            const details = turn.error?.additionalDetails ? `\n${turn.error.additionalDetails}` : '';
            errorMessage = `${turn.error?.message ?? 'Codex turn failed'}${details}`;
          } else if (turn?.status === 'interrupted' && state.abortController.signal.aborted) {
            killReason = state.stoppedReason ?? 'stopped';
          }
          turnDoneResolve();
          break;
        }
        case 'error': {
          const err = params.error as { message?: string | null; additionalDetails?: string | null } | undefined;
          if (params.willRetry === true) {
            log('codex app-server reported a retryable turn error', {
              threadId: params.threadId,
              turnId: params.turnId,
              error: err?.message,
            });
            break;
          }
          isError = true;
          const details = err?.additionalDetails ? `\n${err.additionalDetails}` : '';
          errorMessage = `${err?.message ?? 'codex app-server error'}${details}`;
          turnDoneResolve();
          break;
        }
        default:
          break;
      }
    };

    const requestApprovalDecision = async (
      toolName: string,
      toolInput: Record<string, unknown>,
      toolUseId: string,
    ): Promise<'accept' | 'decline'> => {
      const decision = await engineOpts.canUseTool(toolName, toolInput, {
        signal: state.abortController.signal,
        toolUseID: toolUseId,
      });
      if (decision.behavior === 'allow') {
        return 'accept';
      }
      log('Denied codex app-server approval request', {
        toolName,
        toolUseId,
        reason: decision.message,
      });
      return 'decline';
    };

    const handleServerRequest = async (request: CodexAppServerServerRequest): Promise<unknown> => {
      switch (request.method) {
        case 'item/commandExecution/requestApproval': {
          const params = request.params as {
            itemId?: string;
            command?: string | null;
            cwd?: string | null;
            reason?: string | null;
            commandActions?: unknown;
          };
          return requestApprovalDecision('Bash', {
            command: params.command ?? '',
            cwd: params.cwd ?? options.cwd,
            reason: params.reason ?? undefined,
            commandActions: params.commandActions ?? undefined,
          }, params.itemId ?? String(request.id));
        }
        case 'item/fileChange/requestApproval': {
          const params = request.params as {
            itemId?: string;
            reason?: string | null;
            grantRoot?: string | null;
          };
          return requestApprovalDecision('Write', {
            file_path: params.grantRoot ?? undefined,
            grantRoot: params.grantRoot ?? undefined,
            reason: params.reason ?? undefined,
          }, params.itemId ?? String(request.id));
        }
        case 'item/tool/call': {
          const params = request.params as {
            callId?: string;
            tool?: string;
            arguments?: unknown;
          };
          const toolName = typeof params.tool === 'string' ? params.tool : 'unknown_tool';
          const toolId = typeof params.callId === 'string' ? params.callId : String(request.id);
          const input = JSON.stringify(params.arguments ?? {}).slice(0, 2000);
          const message = `Client-handled tool ${toolName} is not implemented yet in CodexAppServerLib.`;
          onMessage?.({
            type: 'tool_use',
            toolName,
            toolId,
            input,
            timestamp: Date.now(),
          });
          onMessage?.({
            type: 'tool_result',
            toolId,
            result: message,
            timestamp: Date.now(),
          });
          onUserToolResult?.(toolId, message);
          return {
            success: false,
            contentItems: [{ type: 'inputText', text: message }],
          };
        }
        case 'item/tool/requestUserInput': {
          if (!onQuestionRequest) {
            throw new Error('Codex app-server requestUserInput callback is not configured');
          }
          const params = request.params as {
            itemId?: string;
            questions?: Array<{
              id?: string;
              header?: string;
              question?: string;
              options?: Array<{ label?: string; description?: string }> | null;
            }>;
          };
          const questionId = typeof params.itemId === 'string' ? params.itemId : String(request.id);
          const questions = Array.isArray(params.questions)
            ? params.questions
              .filter((question): question is {
                id?: string;
                header?: string;
                question?: string;
                options?: Array<{ label?: string; description?: string }> | null;
              } => !!question && typeof question === 'object')
              .map((question) => ({
                question: typeof question.question === 'string' ? question.question : '',
                header: typeof question.header === 'string' ? question.header : undefined,
                options: Array.isArray(question.options)
                  ? question.options
                    .filter((option): option is { label?: string; description?: string } => !!option && typeof option === 'object')
                    .map((option) => ({
                      label: typeof option.label === 'string' ? option.label : '',
                      description: typeof option.description === 'string' ? option.description : undefined,
                    }))
                  : [],
              }))
              .filter((question) => question.question.length > 0)
            : [];
          const answers = await onQuestionRequest({ questionId, questions });
          return {
            answers: Object.fromEntries(
              Object.entries(answers).map(([key, values]) => [key, { answers: values }]),
            ),
          };
        }
        default:
          throw new Error(`Unsupported codex app-server request: ${request.method}`);
      }
    };

    activeRun = {
      client: this.createClient({
        cwd: options.cwd,
        env,
        onNotification: (notification) => handleNotification(notification),
        onServerRequest: handleServerRequest,
        onStderr: (chunk) => {
          log('codex app-server stderr', { chunk: chunk.trim().slice(0, 500) });
        },
        clientInfo: { name: 'agents-manager', version: '0.0.0' },
      }),
      interrupted: false,
    };
    this.activeRuns.set(runId, activeRun);

    try {
      await activeRun.client.start();

      const systemPrompt = typeof options.systemPrompt === 'string' ? options.systemPrompt : undefined;
      const developerInstructions = typeof options.systemPrompt === 'object' && options.systemPrompt?.type === 'preset'
        ? options.systemPrompt.append ?? null
        : null;
      const sandbox = options.readOnly ? 'read-only' : 'workspace-write';

      if (resumeThreadId) {
        log('Resuming Codex app-server thread from in-memory mapping', {
          sessionId: options.sessionId,
          threadId: resumeThreadId,
        });
        const response = await activeRun.client.threadResume({
          threadId: resumeThreadId,
          model: options.model ?? null,
          cwd: options.cwd,
          approvalPolicy: 'never',
          sandbox,
          baseInstructions: systemPrompt ?? null,
          developerInstructions,
          persistExtendedHistory: true,
        });
        rememberThread(response.thread);
      } else {
        const response = await activeRun.client.threadStart({
          model: options.model ?? null,
          cwd: options.cwd,
          approvalPolicy: 'never',
          sandbox,
          baseInstructions: systemPrompt ?? null,
          developerInstructions,
          experimentalRawEvents: false,
          persistExtendedHistory: true,
        });
        rememberThread(response.thread);
      }

      if (!threadId) {
        throw new Error('codex app-server did not return a thread id');
      }

      const response = await activeRun.client.turnStart({
        threadId,
        input: [{ type: 'text', text: effectivePrompt, text_elements: [] }],
        cwd: options.cwd,
        approvalPolicy: 'never',
        model: options.model ?? null,
        outputSchema: (options.outputFormat ?? null) as Record<string, unknown> | null,
      });
      turnId = response.turn.id;
      activeRun.turnId = response.turn.id;

      if (response.turn.status === 'failed') {
        isError = true;
        errorMessage = response.turn.error?.message ?? 'Codex turn failed';
      } else if (response.turn.status === 'completed') {
        turnDoneResolve();
      }

      await turnDone;
      structuredOutput = parseStructuredOutput(finalAssistantText);
    } catch (err) {
      if (state.abortController.signal.aborted) {
        killReason = state.stoppedReason ?? 'stopped';
        errorMessage = `codex app-server run aborted [kill_reason=${killReason}]`;
      } else {
        isError = true;
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    } finally {
      state.abortController.signal.removeEventListener('abort', abortListener);
      this.activeRuns.delete(runId);
      await activeRun.client.close().catch(() => undefined);
    }

    if (state.abortController.signal.aborted) {
      return {
        isError: true,
        errorMessage: errorMessage ?? `codex app-server run aborted [kill_reason=${state.stoppedReason ?? 'stopped'}]`,
        killReason: killReason ?? state.stoppedReason ?? 'stopped',
        rawExitCode: 1,
        fallbackOutput: finalAssistantText || undefined,
        costInputTokens: state.accumulatedInputTokens || undefined,
        costOutputTokens: state.accumulatedOutputTokens || undefined,
        cacheReadInputTokens: state.accumulatedCacheReadInputTokens || undefined,
        contextWindow,
        lastContextInputTokens,
        structuredOutput,
      };
    }

    return {
      isError,
      errorMessage,
      rawExitCode: isError ? 1 : 0,
      fallbackOutput: finalAssistantText || undefined,
      costInputTokens: state.accumulatedInputTokens || undefined,
      costOutputTokens: state.accumulatedOutputTokens || undefined,
      cacheReadInputTokens: state.accumulatedCacheReadInputTokens || undefined,
      contextWindow,
      lastContextInputTokens,
      structuredOutput,
    };
  }

  private loadPersistedSessionThreadIds(): void {
    try {
      if (!fs.existsSync(this.sessionMapPath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.sessionMapPath, 'utf8')) as PersistedThreadMap;
      for (const [sessionId, value] of Object.entries(parsed)) {
        if (value?.threadId) {
          this.sessionThreadIds.set(sessionId, value.threadId);
        }
      }
    } catch {
      // Best-effort only. Corrupt cache should not break the engine.
    }
  }

  private rememberSessionThreadId(sessionId: string, threadId: string): void {
    this.sessionThreadIds.set(sessionId, threadId);
    this.persistSessionThreadIds();
  }

  private persistSessionThreadIds(): void {
    try {
      const dir = path.dirname(this.sessionMapPath);
      fs.mkdirSync(dir, { recursive: true });
      const serialized: PersistedThreadMap = {};
      for (const [sessionId, threadId] of this.sessionThreadIds.entries()) {
        serialized[sessionId] = {
          threadId,
          updatedAt: Date.now(),
        };
      }
      fs.writeFileSync(this.sessionMapPath, JSON.stringify(serialized, null, 2), 'utf8');
    } catch {
      // Best-effort only. In-memory resume still works within the process.
    }
  }
}
