import { spawn, type ChildProcess } from 'child_process';
import type { IAgentLib, AgentLibFeatures, AgentLibRunOptions, AgentLibCallbacks, AgentLibResult, AgentLibTelemetry, AgentLibModelOption } from '../interfaces/agent-lib';
import type { ISessionHistoryProvider } from '../interfaces/session-history-provider';
import { SessionHistoryFormatter } from '../services/session-history-formatter';
import { getShellEnv } from '../services/shell-env';
import { getAppLogger } from '../services/app-logger';

interface RunState {
  process: ChildProcess;
  accumulatedInputTokens: number;
  accumulatedOutputTokens: number;
  messageCount: number;
  timeout: number;
  maxTurns: number;
  killTimer?: ReturnType<typeof setTimeout>;
  thinkingBuffer: string;
}

export class CursorAgentLib implements IAgentLib {
  readonly name = 'cursor-agent';

  private runningStates = new Map<string, RunState>();
  /** Tracks why a process was killed, survives the stop() → close gap. */
  private stoppedReasons = new Map<string, string>();

  constructor(private sessionHistoryProvider?: ISessionHistoryProvider) {}

  supportedFeatures(): AgentLibFeatures {
    return { images: false, hooks: false, thinking: true, nativeResume: false };
  }

  getDefaultModel(): string { return 'opus-4.6-thinking'; }

  getSupportedModels(): AgentLibModelOption[] {
    return [
      { value: 'opus-4.6-thinking', label: 'Claude 4.6 Opus (Thinking)' },
      { value: 'opus-4.6', label: 'Claude 4.6 Opus' },
      { value: 'opus-4.5', label: 'Claude 4.5 Opus' },
      { value: 'opus-4.5-thinking', label: 'Claude 4.5 Opus (Thinking)' },
      { value: 'sonnet-4.6', label: 'Claude 4.6 Sonnet' },
      { value: 'sonnet-4.6-thinking', label: 'Claude 4.6 Sonnet (Thinking)' },
      { value: 'sonnet-4.5', label: 'Claude 4.5 Sonnet' },
      { value: 'sonnet-4.5-thinking', label: 'Claude 4.5 Sonnet (Thinking)' },
      { value: 'gpt-5.4', label: 'GPT-5.4' },
      { value: 'gpt-5.4-2026-03-05', label: 'GPT-5.4 (2026-03-05 snapshot)' },
      { value: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
      { value: 'gpt-5.4-pro-2026-03-05', label: 'GPT-5.4 Pro (2026-03-05 snapshot)' },
      { value: 'codex-mini-latest', label: 'Codex Mini Latest' },
      { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex (Legacy)' },
      { value: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
      { value: 'gemini-3-pro', label: 'Gemini 3 Pro' },
      { value: 'gemini-3-flash', label: 'Gemini 3 Flash' },
    ];
  }

  async isAvailable(): Promise<boolean> {
    try {
      const env = getShellEnv();
      return new Promise((resolve) => {
        const proc = spawn('cursor-agent', ['--version'], { env, stdio: 'pipe' });
        const timer = setTimeout(() => { proc.kill(); resolve(false); }, 5000);
        proc.on('error', () => { clearTimeout(timer); resolve(false); });
        proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
      });
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
      accumulatedCacheReadInputTokens: 0,
      accumulatedCacheCreationInputTokens: 0,
      messageCount: state.messageCount,
      timeout: state.timeout,
      maxTurns: state.maxTurns,
    };
  }

  async execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult> {
    const { onOutput, onLog, onMessage, onUserToolResult } = callbacks;
    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);

    // Session resume: prepend prior session history to the prompt
    let effectivePrompt = options.prompt;
    if (options.resumeSession && this.sessionHistoryProvider && options.taskId && options.agentType) {
      try {
        const prevMessages = await this.sessionHistoryProvider.getPreviousMessages(options.taskId, options.agentType);
        if (prevMessages && prevMessages.length > 0) {
          const history = SessionHistoryFormatter.format(prevMessages);
          effectivePrompt = history + '\n\n---\n\n' + options.prompt;
          log('Session history prepended to prompt', { messageCount: prevMessages.length, historyLength: history.length });
        }
      } catch (err) {
        log(`Failed to load session history (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const args = [effectivePrompt, '-p', '--output-format', 'stream-json', '--force'];
    if (options.readOnly) {
      args.push('--mode=plan');
    }
    if (options.model) {
      args.push('--model', options.model);
    }

    log(`Spawning cursor-agent`, { args: args.slice(0, 6), cwd: options.cwd, timeout: options.timeoutMs, maxTurns: options.maxTurns });

    const env = getShellEnv();
    const proc = spawn('cursor-agent', args, { cwd: options.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdin?.end();

    const state: RunState = {
      process: proc,
      accumulatedInputTokens: 0,
      accumulatedOutputTokens: 0,
      messageCount: 0,
      timeout: options.timeoutMs,
      maxTurns: options.maxTurns,
      thinkingBuffer: '',
    };
    this.runningStates.set(runId, state);

    let resultText = '';
    let isError = false;
    let errorMessage: string | undefined;
    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;
    let structuredOutput: Record<string, unknown> | undefined;
    const resultRef = { structuredOutput: undefined as Record<string, unknown> | undefined, isError: false, errorMessage: undefined as string | undefined };

    /** Appended to resultText AND streamed to onOutput for real-time display */
    const emit = (chunk: string) => {
      resultText += chunk;
      onOutput?.(chunk);
    };
    /** Stream-only: sent to onOutput for real-time display but NOT stored in resultText */
    const stream = (chunk: string) => {
      onOutput?.(chunk);
    };

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.stoppedReasons.set(runId, 'timeout');
      if (proc.pid) {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
      } else {
        proc.kill('SIGTERM');
      }
      state.killTimer = setTimeout(() => {
        if (proc.pid) {
          try { process.kill(-proc.pid, 'SIGKILL'); } catch (err) {
            getAppLogger().warn('CursorAgentLib', `SIGKILL failed for pid ${proc.pid}`, { error: err instanceof Error ? err.message : String(err) });
          }
        }
      }, 5000);
    }, options.timeoutMs);

    return new Promise<AgentLibResult>((resolve) => {
      let stderrOutput = '';
      let stdoutBuffer = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        // Keep the last (possibly incomplete) chunk in the buffer
        stdoutBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line) continue;
          state.messageCount++;

          if (state.messageCount % 25 === 0) {
            log(`Message loop heartbeat: ${state.messageCount} messages processed`, {
              inputTokens: state.accumulatedInputTokens,
              outputTokens: state.accumulatedOutputTokens,
            });
          }

          let msg: Record<string, unknown> | null = null;
          try { msg = JSON.parse(line); } catch { /* not JSON */ }

          if (!msg) {
            emit(line + '\n');
            continue;
          }

          try {
            this.processMessage(msg, state, resultRef, { emit, stream, onMessage, onUserToolResult, log });
          } catch (err) {
            log(`Error processing message: ${err instanceof Error ? err.message : String(err)}`);
            emit(line + '\n');
          }
        }
      });

      const STDERR_MAX = 64 * 1024;
      proc.stderr?.on('data', (data: Buffer) => {
        if (stderrOutput.length < STDERR_MAX) {
          stderrOutput += data.toString();
          if (stderrOutput.length > STDERR_MAX) stderrOutput = stderrOutput.slice(0, STDERR_MAX);
        }
      });

      proc.on('close', (code, signal) => {
        // Flush any remaining buffered stdout
        if (stdoutBuffer.trim()) {
          state.messageCount++;
          let msg: Record<string, unknown> | null = null;
          try { msg = JSON.parse(stdoutBuffer); } catch { /* not JSON */ }
          if (msg) {
            try {
              this.processMessage(msg, state, resultRef, { emit, stream, onMessage, onUserToolResult, log });
            } catch { emit(stdoutBuffer + '\n'); }
          } else {
            emit(stdoutBuffer + '\n');
          }
        }

        clearTimeout(timer);
        if (state.killTimer) clearTimeout(state.killTimer);
        this.runningStates.delete(runId);

        let killReason: string | undefined;
        const rawExitCode = code ?? (signal === 'SIGTERM' ? 143 : signal === 'SIGKILL' ? 137 : undefined);
        const isSignalExit = rawExitCode === 143 || rawExitCode === 137 || signal != null;

        if (timedOut) {
          isError = true;
          killReason = 'timeout';
          errorMessage = `cursor-agent timed out after ${Math.round(options.timeoutMs / 1000)}s`;
        } else if (isSignalExit) {
          killReason = this.stoppedReasons.get(runId) ?? 'external_signal';
          isError = true;
          errorMessage = stderrOutput || `cursor-agent exited with code ${rawExitCode} [kill_reason=${killReason}]`;
        } else if (code !== 0 && !isError) {
          isError = true;
          const baseError = stderrOutput || `cursor-agent exited with code ${code}`;
          // Include diagnostics for unexpected failures
          const diagnostics = [
            `error: ${baseError}`,
            ...(stderrOutput ? [`stderr: ${stderrOutput}`] : []),
            `exit_code: ${code}`,
            `messages_processed: ${state.messageCount}`,
            `cwd: ${options.cwd}`,
            `model: ${options.model ?? 'default'}`,
            `max_turns: ${options.maxTurns}`,
            `timeout: ${Math.round(options.timeoutMs / 1000)}s`,
            `accumulated_tokens: ${state.accumulatedInputTokens}/${state.accumulatedOutputTokens}`,
            `result_text_length: ${resultText.length}`,
          ].join('\n');
          errorMessage = `${baseError}\n\n--- Diagnostics ---\n${diagnostics}`;
        }

        if (isError) {
          log(`cursor-agent failed`, {
            error: errorMessage,
            stderr: stderrOutput || undefined,
            exitCode: code,
            signal,
            killReason,
            messagesProcessed: state.messageCount,
            cwd: options.cwd,
            model: options.model,
            resultTextLength: resultText.length,
          });
        }

        this.stoppedReasons.delete(runId);

        if (resultRef.structuredOutput) structuredOutput = resultRef.structuredOutput;
        if (resultRef.isError) {
          isError = true;
          if (!errorMessage) errorMessage = resultRef.errorMessage;
        }

        costInputTokens = state.accumulatedInputTokens > 0 ? state.accumulatedInputTokens : costInputTokens;
        costOutputTokens = state.accumulatedOutputTokens > 0 ? state.accumulatedOutputTokens : costOutputTokens;

        log(`cursor-agent completed: exitCode=${code}, messages=${state.messageCount}`, {
          inputTokens: costInputTokens,
          outputTokens: costOutputTokens,
          hasStructuredOutput: !!structuredOutput,
        });

        resolve({
          exitCode: isError ? 1 : 0,
          output: resultText || errorMessage || '',
          error: isError ? errorMessage : undefined,
          costInputTokens,
          costOutputTokens,
          model: options.model ?? this.getDefaultModel(),
          structuredOutput,
          killReason,
          rawExitCode: rawExitCode ?? undefined,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (state.killTimer) clearTimeout(state.killTimer);
        this.runningStates.delete(runId);
        this.stoppedReasons.delete(runId);
        isError = true;
        errorMessage = `Failed to spawn cursor-agent: ${err.message}\n\n--- Diagnostics ---\nspawn_error: ${err.message}\ncwd: ${options.cwd}\nmodel: ${options.model ?? 'default'}\nPATH: ${(env.PATH ?? '').split(':').slice(0, 5).join(':')}...`;
        log(`cursor-agent spawn error`, {
          error: err.message,
          stack: err.stack,
          cwd: options.cwd,
          model: options.model,
        });
        resolve({
          exitCode: 1,
          output: resultText || errorMessage,
          error: errorMessage,
          model: options.model ?? this.getDefaultModel(),
        });
      });
    });
  }

  async stop(runId: string): Promise<void> {
    const state = this.runningStates.get(runId);
    if (!state) {
      getAppLogger().warn('CursorAgentLib', `stop called for unknown runId: ${runId}`);
      return;
    }
    this.stoppedReasons.set(runId, 'stopped');
    const pid = state.process.pid;
    if (pid) {
      try { process.kill(-pid, 'SIGTERM'); } catch { state.process.kill('SIGTERM'); }
    } else {
      state.process.kill('SIGTERM');
    }
    state.killTimer = setTimeout(() => {
      if (pid) {
        try { process.kill(-pid, 'SIGKILL'); } catch (err) {
          getAppLogger().warn('CursorAgentLib', `SIGKILL failed for pid ${pid}`, { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }, 5000);
  }

  /**
   * Processes a single parsed JSON message from the cursor-agent stream.
   * Extracted to keep the stdout handler readable and testable.
   */
  private processMessage(
    msg: Record<string, unknown>,
    state: RunState,
    resultRef: { structuredOutput?: Record<string, unknown>; isError: boolean; errorMessage?: string },
    ctx: {
      emit: (chunk: string) => void;
      stream: (chunk: string) => void;
      onMessage?: AgentLibCallbacks['onMessage'];
      onUserToolResult?: AgentLibCallbacks['onUserToolResult'];
      log: (msg: string, data?: Record<string, unknown>) => void;
    },
  ): void {
    const { emit, stream, onMessage, onUserToolResult, log } = ctx;

    switch (msg.type) {
      case 'assistant': {
        const assistantMsg = msg.message as { content?: Array<{ type: string; text?: string; thinking?: string; name?: string; input?: unknown; id?: string }> } | undefined;
        if (!assistantMsg?.content) break;
        for (const block of assistantMsg.content) {
          if (block.type === 'text' && block.text) {
            emit(block.text + '\n');
            onMessage?.({ type: 'assistant_text', text: block.text, timestamp: Date.now() });
          } else if (block.type === 'thinking' && block.thinking) {
            onMessage?.({ type: 'thinking', text: block.thinking, timestamp: Date.now() });
          } else if (block.type === 'tool_use') {
            const toolName = block.name ?? 'unknown';
            const input = JSON.stringify(block.input ?? {});
            stream(`\n> Tool: ${toolName}\n> Input: ${input.slice(0, 2000)}${input.length > 2000 ? '...' : ''}\n`);
            onMessage?.({ type: 'tool_use', toolName, toolId: block.id, input: input.slice(0, 2000), timestamp: Date.now() });
          }
        }
        break;
      }

      case 'text':
      case 'message': {
        const text = (msg.text ?? msg.content ?? '') as string;
        emit(text + '\n');
        onMessage?.({ type: 'assistant_text', text, timestamp: Date.now() });
        break;
      }

      case 'thinking': {
        const thinking = (msg.thinking ?? msg.text ?? '') as string;
        if (msg.subtype === 'delta') {
          state.thinkingBuffer += thinking;
        } else if (msg.subtype === 'completed') {
          const full = state.thinkingBuffer || thinking;
          state.thinkingBuffer = '';
          if (full) {
            onMessage?.({ type: 'thinking', text: full, timestamp: Date.now() });
          }
        } else if (thinking) {
          onMessage?.({ type: 'thinking', text: thinking, timestamp: Date.now() });
        }
        break;
      }

      case 'tool_use': {
        const toolName = (msg.name ?? msg.tool ?? 'unknown') as string;
        const input = JSON.stringify(msg.input ?? msg.arguments ?? {});
        const toolId = msg.id as string | undefined;
        stream(`\n> Tool: ${toolName}\n> Input: ${input.slice(0, 2000)}${input.length > 2000 ? '...' : ''}\n`);
        onMessage?.({ type: 'tool_use', toolName, toolId, input: input.slice(0, 2000), timestamp: Date.now() });
        break;
      }

      case 'tool_call': {
        // cursor-agent format: { type: "tool_call", subtype: "started"|"completed",
        //   call_id: "...", tool_call: { readToolCall: { args: {...}, result?: {...} } } }
        const callId = msg.call_id as string | undefined;
        const toolCallObj = msg.tool_call as Record<string, { args?: Record<string, unknown>; result?: unknown }> | undefined;
        if (!toolCallObj) break;
        const toolKey = Object.keys(toolCallObj)[0];
        if (!toolKey) break;
        const toolName = toolKey.replace(/ToolCall$/, '');
        const toolData = toolCallObj[toolKey];

        if (msg.subtype === 'started') {
          const cleanArgs = CursorAgentLib.extractCleanArgs(toolName, toolData.args);
          const input = JSON.stringify(cleanArgs);
          stream(`\n> Tool: ${toolName}\n> Input: ${input.slice(0, 2000)}${input.length > 2000 ? '...' : ''}\n`);
          onMessage?.({ type: 'tool_use', toolName, toolId: callId, input: input.slice(0, 2000), timestamp: Date.now() });
        } else if (msg.subtype === 'completed') {
          const cleanResult = CursorAgentLib.extractCleanResult(toolName, toolData.result);
          onMessage?.({ type: 'tool_result', toolId: callId, result: cleanResult.slice(0, 2000), timestamp: Date.now() });
          if (callId) {
            onUserToolResult?.(callId, cleanResult.slice(0, 2000));
          }
        }
        break;
      }

      case 'tool_result': {
        const toolId = (msg.tool_use_id ?? msg.call_id ?? msg.id) as string | undefined;
        const result = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result ?? '');
        onMessage?.({ type: 'tool_result', toolId, result: result.slice(0, 2000), timestamp: Date.now() });
        if (toolId) {
          onUserToolResult?.(toolId, result.slice(0, 2000));
        }
        break;
      }

      case 'usage': {
        const inputTokens = ((msg.input_tokens ?? msg.inputTokens) ?? 0) as number;
        const outputTokens = ((msg.output_tokens ?? msg.outputTokens) ?? 0) as number;
        state.accumulatedInputTokens += inputTokens;
        state.accumulatedOutputTokens += outputTokens;
        onMessage?.({ type: 'usage', inputTokens: state.accumulatedInputTokens, outputTokens: state.accumulatedOutputTokens, timestamp: Date.now() });
        break;
      }

      case 'result': {
        if (msg.structured_output) {
          resultRef.structuredOutput = msg.structured_output as Record<string, unknown>;
        }
        if (msg.usage) {
          const usage = msg.usage as { input_tokens?: number; output_tokens?: number; inputTokens?: number; outputTokens?: number };
          const inTok = usage.input_tokens ?? usage.inputTokens;
          const outTok = usage.output_tokens ?? usage.outputTokens;
          if (inTok) state.accumulatedInputTokens = inTok;
          if (outTok) state.accumulatedOutputTokens = outTok;
          onMessage?.({ type: 'usage', inputTokens: state.accumulatedInputTokens, outputTokens: state.accumulatedOutputTokens, timestamp: Date.now() });
        }
        if (msg.subtype !== 'success' && msg.errors) {
          const errors = msg.errors as string[];
          resultRef.isError = true;
          resultRef.errorMessage = errors.join('\n');
          log(`cursor-agent result errors: ${errors.join('; ')}`);
        }
        break;
      }

      case 'error': {
        const errorMsg = (msg.message ?? msg.error ?? 'Unknown error') as string;
        resultRef.isError = true;
        resultRef.errorMessage = errorMsg;
        emit(`[error] ${errorMsg}\n`);
        break;
      }

      case 'system':
      case 'user':
        break;

      default:
        break;
    }
  }

  /** Keys that are cursor-agent internal metadata, not meaningful tool input. */
  private static readonly METADATA_KEYS = new Set([
    'toolCallId', 'timeout', 'workingDirectory', 'hasInputRedirect',
    'hasOutputRedirect', 'parsingResult', 'executableCommands',
    'hasRedirects', 'hasCommandSubstitution', 'fileOutputThresholdBytes',
    'isBackground', 'skipConfirmation', 'readRange', 'relatedCursorRulePaths',
    'relatedCursorRules', 'isEmpty', 'exceededLimit', 'totalLines', 'fileSize',
  ]);

  /**
   * Extract only the user-facing fields from cursor-agent tool args,
   * dropping internal metadata that clutters the display.
   */
  private static extractCleanArgs(toolName: string, args?: Record<string, unknown>): Record<string, unknown> {
    if (!args) return {};
    // For well-known tools, pick only the primary field
    switch (toolName) {
      case 'shell': return { command: args.command ?? args.fullText };
      case 'read': return { path: args.path };
      case 'write': return { path: args.path };
      case 'edit': return { path: args.path };
      case 'glob':
      case 'list': return { pattern: args.pattern ?? args.path };
      case 'grep':
      case 'search': return { pattern: args.pattern ?? args.query, path: args.path };
    }
    // For unknown tools, drop metadata keys
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (!CursorAgentLib.METADATA_KEYS.has(k)) clean[k] = v;
    }
    return clean;
  }

  /**
   * Extract a readable result string from cursor-agent tool_call completed payload.
   * The result is deeply nested: { success: { content, ... } } or { error: { ... } }
   */
  private static extractCleanResult(_toolName: string, result?: unknown): string {
    if (!result || typeof result !== 'object') return typeof result === 'string' ? result : JSON.stringify(result ?? '');
    const r = result as Record<string, unknown>;
    if (r.success && typeof r.success === 'object') {
      const s = r.success as Record<string, unknown>;
      if (typeof s.content === 'string') return s.content;
      if (typeof s.output === 'string') return s.output;
      return JSON.stringify(s);
    }
    if (r.error && typeof r.error === 'object') {
      const e = r.error as Record<string, unknown>;
      return typeof e.message === 'string' ? e.message : JSON.stringify(e);
    }
    if (typeof r.content === 'string') return r.content;
    if (typeof r.output === 'string') return r.output;
    return JSON.stringify(result);
  }
}
