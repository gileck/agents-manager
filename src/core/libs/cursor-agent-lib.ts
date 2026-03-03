import { spawn, type ChildProcess } from 'child_process';
import type { IAgentLib, AgentLibRunOptions, AgentLibCallbacks, AgentLibResult, AgentLibTelemetry, AgentLibModelOption } from '../interfaces/agent-lib';
import { getShellEnv } from '../services/shell-env';
import { getAppLogger } from '../services/app-logger';

interface RunState {
  process: ChildProcess;
  messageCount: number;
  timeout: number;
  maxTurns: number;
  killTimer?: ReturnType<typeof setTimeout>;
}

export class CursorAgentLib implements IAgentLib {
  readonly name = 'cursor-agent';

  private runningStates = new Map<string, RunState>();
  /** Tracks why a process was killed, survives the stop() → close gap. */
  private stoppedReasons = new Map<string, string>();

  getDefaultModel(): string { return 'claude-4.6-opus'; }

  getSupportedModels(): AgentLibModelOption[] {
    return [
      { value: 'claude-4.6-sonnet', label: 'Claude 4.6 Sonnet' },
      { value: 'claude-4.6-opus', label: 'Claude 4.6 Opus' },
      { value: 'claude-4.5-sonnet', label: 'Claude 4.5 Sonnet' },
      { value: 'gpt-5.2', label: 'GPT-5.2' },
      { value: 'gpt-5', label: 'GPT-5' },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { value: 'composer-1.5', label: 'Composer 1.5' },
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
      accumulatedInputTokens: 0,
      accumulatedOutputTokens: 0,
      messageCount: state.messageCount,
      timeout: state.timeout,
      maxTurns: state.maxTurns,
    };
  }

  async execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult> {
    const { onOutput, onLog, onMessage } = callbacks;
    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);

    const args = [JSON.stringify(options.prompt), '-p', '--output-format', 'stream-json'];
    if (options.readOnly) {
      args.push('--mode=plan');
    } else {
      args.push('--force');
    }
    if (options.model) {
      args.push('--model', options.model);
    }

    log(`Spawning cursor-agent`, { args: args.slice(0, 4), cwd: options.cwd });

    const env = getShellEnv();
    const proc = spawn('cursor-agent', args, { cwd: options.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });

    const state: RunState = { process: proc, messageCount: 0, timeout: options.timeoutMs, maxTurns: options.maxTurns };
    this.runningStates.set(runId, state);

    let resultText = '';
    let isError = false;
    let errorMessage: string | undefined;

    const emit = (chunk: string) => {
      resultText += chunk;
      onOutput?.(chunk);
    };

    // Timeout handling
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.stoppedReasons.set(runId, 'timeout');
      try { process.kill(-proc.pid!, 'SIGTERM'); } catch { proc.kill('SIGTERM'); }
      state.killTimer = setTimeout(() => { try { process.kill(-proc.pid!, 'SIGKILL'); } catch { /* process already exited */ } }, 5000);
    }, options.timeoutMs);

    return new Promise<AgentLibResult>((resolve) => {
      let stderrOutput = '';

      proc.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          state.messageCount++;
          let msg: Record<string, unknown> | null = null;
          try { msg = JSON.parse(line); } catch { /* not JSON */ }

          if (!msg) {
            emit(line + '\n');
          } else {
            try {
              if (msg.type === 'text' || msg.type === 'message') {
                const text = (msg.text ?? msg.content ?? '') as string;
                emit(text + '\n');
                onMessage?.({ type: 'assistant_text', text, timestamp: Date.now() });
              } else if (msg.type === 'tool_use' || msg.type === 'tool_call') {
                const toolName = (msg.name ?? msg.tool ?? 'unknown') as string;
                const input = JSON.stringify(msg.input ?? msg.arguments ?? {});
                emit(`\n> Tool: ${toolName}\n> Input: ${input.slice(0, 2000)}\n`);
                onMessage?.({ type: 'tool_use', toolName, input: input.slice(0, 2000), timestamp: Date.now() });
              } else if (msg.type === 'tool_result') {
                const result = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result ?? '');
                onMessage?.({ type: 'tool_result', result: result.slice(0, 2000), timestamp: Date.now() });
              } else if (msg.type === 'error') {
                isError = true;
                errorMessage = (msg.message ?? msg.error ?? 'Unknown error') as string;
                emit(`[error] ${errorMessage}\n`);
              }
            } catch (err) {
              log(`Error processing message: ${err instanceof Error ? err.message : String(err)}`);
              emit(line + '\n');
            }
          }
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderrOutput += data.toString();
      });

      proc.on('close', (code, signal) => {
        clearTimeout(timer);
        if (state.killTimer) clearTimeout(state.killTimer);
        this.runningStates.delete(runId);

        // Determine kill reason for signal-related exits
        let killReason: string | undefined;
        const rawExitCode = code ?? (signal === 'SIGTERM' ? 143 : signal === 'SIGKILL' ? 137 : undefined);
        const isSignalExit = rawExitCode === 143 || rawExitCode === 137 || signal != null;

        if (timedOut) {
          isError = true;
          killReason = 'timeout';
          errorMessage = `cursor-agent timed out after ${Math.round(options.timeoutMs / 1000)}s`;
          log(errorMessage);
        } else if (isSignalExit) {
          killReason = this.stoppedReasons.get(runId) ?? 'external_signal';
          isError = true;
          errorMessage = stderrOutput || `cursor-agent exited with code ${rawExitCode} [kill_reason=${killReason}]`;
          log(`cursor-agent killed: ${errorMessage}`);
        } else if (code !== 0 && !isError) {
          isError = true;
          errorMessage = stderrOutput || `cursor-agent exited with code ${code}`;
          log(`cursor-agent failed: ${errorMessage}`);
        }

        this.stoppedReasons.delete(runId);

        log(`cursor-agent completed: exitCode=${code}, messages=${state.messageCount}`);

        resolve({
          exitCode: isError ? 1 : 0,
          output: resultText || errorMessage || '',
          error: isError ? errorMessage : undefined,
          model: options.model ?? this.getDefaultModel(),
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
        errorMessage = `Failed to spawn cursor-agent: ${err.message}`;
        log(errorMessage);
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
    try { process.kill(-state.process.pid!, 'SIGTERM'); } catch { state.process.kill('SIGTERM'); }
    state.killTimer = setTimeout(() => { try { process.kill(-state.process.pid!, 'SIGKILL'); } catch { /* process already exited */ } }, 5000);
    this.runningStates.delete(runId);
  }
}
