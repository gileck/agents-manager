import { spawn, type ChildProcess } from 'child_process';
import type { AgentLibFeatures, AgentLibCallbacks, AgentLibModelOption } from '../interfaces/agent-lib';
import { getShellEnv } from '../services/shell-env';
import { getAppLogger } from '../services/app-logger';
import { BaseAgentLib, type BaseRunState, type EngineRunOptions, type EngineResult } from './base-agent-lib';

// ============================================
// CursorAgentLib — cursor-agent CLI subprocess engine
// ============================================

export class CursorAgentLib extends BaseAgentLib {
  readonly name = 'cursor-agent';

  /** Track active child processes for stop/timeout — keyed by runId. */
  private processes = new Map<string, ChildProcess>();
  /** SIGKILL escalation timers — keyed by runId. */
  private killTimers = new Map<string, ReturnType<typeof setTimeout>>();

  supportedFeatures(): AgentLibFeatures {
    return { images: false, hooks: false, thinking: true, nativeResume: false, streamingInput: false };
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

  protected doStop(runId: string, state: BaseRunState): void {
    state.stoppedReason = 'stopped';
    // abort() fires the onAbort listener in runEngine which calls killProcess
    state.abortController.abort();
  }

  protected async runEngine(
    runId: string,
    state: BaseRunState,
    engineOpts: EngineRunOptions,
  ): Promise<EngineResult> {
    const { options, callbacks, log, emit, stream } = engineOpts;
    const { onMessage, onUserToolResult } = callbacks;

    // Session resume: prompt replay fallback (no native resume for cursor-agent)
    const effectivePrompt = await this.resolveSessionPrompt(engineOpts.prompt, options, log);

    const args = [effectivePrompt, '-p', '--output-format', 'stream-json', '--force'];
    if (options.readOnly) {
      args.push('--mode=plan');
    }
    if (options.model) {
      args.push('--model', options.model);
    }

    log('Spawning cursor-agent', { args: args.slice(0, 6), cwd: options.cwd, timeout: options.timeoutMs, maxTurns: options.maxTurns });

    const env = getShellEnv();
    const proc = spawn('cursor-agent', args, { cwd: options.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdin?.end();
    this.processes.set(runId, proc);

    // Listen for abort signal (from base class timeout or stop()) to kill the subprocess
    const onAbort = () => this.killProcess(runId, proc);
    state.abortController.signal.addEventListener('abort', onAbort, { once: true });

    // Thinking buffer for delta → completed assembly
    let thinkingBuffer = '';

    const resultRef = { structuredOutput: undefined as Record<string, unknown> | undefined, isError: false, errorMessage: undefined as string | undefined };

    return new Promise<EngineResult>((resolve) => {
      let stderrOutput = '';
      let stdoutBuffer = '';

      const processMsg = (msg: Record<string, unknown>) => {
        this.processMessage(msg, state, resultRef, thinkingBuffer, {
          emit, stream, onMessage, onUserToolResult, log,
          setThinkingBuffer: (v: string) => { thinkingBuffer = v; },
        });
      };

      proc.stdout?.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line) continue;
          state.messageCount++;

          let msg: Record<string, unknown> | null = null;
          try { msg = JSON.parse(line); } catch { /* not JSON */ }

          if (!msg) {
            emit(line + '\n');
            continue;
          }

          try {
            processMsg(msg);
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
        // Flush remaining buffered stdout
        if (stdoutBuffer.trim()) {
          state.messageCount++;
          let msg: Record<string, unknown> | null = null;
          try { msg = JSON.parse(stdoutBuffer); } catch { /* not JSON */ }
          if (msg) {
            try { processMsg(msg); } catch { emit(stdoutBuffer + '\n'); }
          } else {
            emit(stdoutBuffer + '\n');
          }
        }

        // Cleanup
        state.abortController.signal.removeEventListener('abort', onAbort);
        const killTimer = this.killTimers.get(runId);
        if (killTimer) { clearTimeout(killTimer); this.killTimers.delete(runId); }
        this.processes.delete(runId);

        let killReason: string | undefined;
        let isError = resultRef.isError;
        let errorMessage = resultRef.errorMessage;
        const rawExitCode = code ?? (signal === 'SIGTERM' ? 143 : signal === 'SIGKILL' ? 137 : undefined);
        const isSignalExit = rawExitCode === 143 || rawExitCode === 137 || signal != null;

        if (state.stoppedReason === 'timeout') {
          isError = true;
          killReason = 'timeout';
          errorMessage = `cursor-agent timed out after ${Math.round((options.timeoutMs ?? 0) / 1000)}s`;
        } else if (isSignalExit) {
          killReason = state.stoppedReason ?? 'external_signal';
          isError = true;
          errorMessage = stderrOutput || `cursor-agent exited with code ${rawExitCode} [kill_reason=${killReason}]`;
        } else if (code !== 0 && !isError) {
          isError = true;
          const baseError = stderrOutput || `cursor-agent exited with code ${code}`;
          const diagnostics = this.buildDiagnostics(state, options, {
            error: baseError,
            ...(stderrOutput ? { stderr: stderrOutput } : {}),
            exit_code: code,
          });
          errorMessage = `${baseError}\n\n--- Diagnostics ---\n${diagnostics}`;
        }

        if (isError) {
          log('cursor-agent failed', {
            error: errorMessage,
            stderr: stderrOutput || undefined,
            exitCode: code,
            signal,
            killReason,
            messagesProcessed: state.messageCount,
            cwd: options.cwd,
            model: options.model,
          });
        }

        log(`cursor-agent completed: exitCode=${code}, messages=${state.messageCount}`, {
          inputTokens: state.accumulatedInputTokens,
          outputTokens: state.accumulatedOutputTokens,
          hasStructuredOutput: !!resultRef.structuredOutput,
        });

        resolve({
          isError,
          errorMessage,
          structuredOutput: resultRef.structuredOutput,
          killReason,
          rawExitCode: rawExitCode ?? undefined,
        });
      });

      proc.on('error', (err) => {
        state.abortController.signal.removeEventListener('abort', onAbort);
        const killTimer = this.killTimers.get(runId);
        if (killTimer) { clearTimeout(killTimer); this.killTimers.delete(runId); }
        this.processes.delete(runId);

        const spawnError = `Failed to spawn cursor-agent: ${err.message}`;
        log('cursor-agent spawn error', { error: err.message, stack: err.stack, cwd: options.cwd, model: options.model });
        resolve({
          isError: true,
          errorMessage: `${spawnError}\n\n--- Diagnostics ---\nspawn_error: ${err.message}\ncwd: ${options.cwd}\nmodel: ${options.model ?? 'default'}\nPATH: ${(env.PATH ?? '').split(':').slice(0, 5).join(':')}...`,
        });
      });
    });
  }

  /** Send SIGTERM to process group, escalate to SIGKILL after 5s. */
  private killProcess(runId: string, proc: ChildProcess): void {
    const pid = proc.pid;
    if (pid) {
      try { process.kill(-pid, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
    } else {
      proc.kill('SIGTERM');
    }
    const killTimer = setTimeout(() => {
      if (pid) {
        try { process.kill(-pid, 'SIGKILL'); } catch (err) {
          getAppLogger().warn('CursorAgentLib', `SIGKILL failed for pid ${pid}`, { error: err instanceof Error ? err.message : String(err) });
        }
      }
      this.killTimers.delete(runId);
    }, 5000);
    this.killTimers.set(runId, killTimer);
  }

  /**
   * Process a single parsed JSON message from the cursor-agent stream.
   */
  private processMessage(
    msg: Record<string, unknown>,
    state: BaseRunState,
    resultRef: { structuredOutput?: Record<string, unknown>; isError: boolean; errorMessage?: string },
    thinkingBuffer: string,
    ctx: {
      emit: (chunk: string) => void;
      stream: (chunk: string) => void;
      onMessage?: AgentLibCallbacks['onMessage'];
      onUserToolResult?: AgentLibCallbacks['onUserToolResult'];
      log: (msg: string, data?: Record<string, unknown>) => void;
      setThinkingBuffer: (v: string) => void;
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
            onMessage?.({ type: 'tool_use', toolName, toolId: block.id, input, timestamp: Date.now() });
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
          ctx.setThinkingBuffer(thinkingBuffer + thinking);
        } else if (msg.subtype === 'completed') {
          const full = thinkingBuffer || thinking;
          ctx.setThinkingBuffer('');
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
        onMessage?.({ type: 'tool_use', toolName, toolId, input, timestamp: Date.now() });
        break;
      }

      case 'tool_call': {
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
          onMessage?.({ type: 'tool_use', toolName, toolId: callId, input, timestamp: Date.now() });
        } else if (msg.subtype === 'completed') {
          const cleanResult = CursorAgentLib.extractCleanResult(toolName, toolData.result);
          onMessage?.({ type: 'tool_result', toolId: callId, result: cleanResult, timestamp: Date.now() });
          if (callId) {
            onUserToolResult?.(callId, cleanResult);
          }
        }
        break;
      }

      case 'tool_result': {
        const toolId = (msg.tool_use_id ?? msg.call_id ?? msg.id) as string | undefined;
        const result = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result ?? '');
        onMessage?.({ type: 'tool_result', toolId, result, timestamp: Date.now() });
        if (toolId) {
          onUserToolResult?.(toolId, result);
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

  private static extractCleanArgs(toolName: string, args?: Record<string, unknown>): Record<string, unknown> {
    if (!args) return {};
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
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (!CursorAgentLib.METADATA_KEYS.has(k)) clean[k] = v;
    }
    return clean;
  }

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
