import { spawn, type ChildProcess } from 'child_process';
import type { IAgentLib, AgentLibRunOptions, AgentLibCallbacks, AgentLibResult, AgentLibTelemetry, AgentLibModelOption } from '../interfaces/agent-lib';
import { getShellEnv } from '../services/shell-env';

interface RunState {
  process: ChildProcess;
  messageCount: number;
  timeout: number;
  maxTurns: number;
  killTimer?: ReturnType<typeof setTimeout>;
}

export class CodexCliLib implements IAgentLib {
  readonly name = 'codex-cli';

  private runningStates = new Map<string, RunState>();

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
    try {
      const env = getShellEnv();
      return new Promise((resolve) => {
        const proc = spawn('codex', ['--version'], { env, stdio: 'pipe' });
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

    const sandboxMode = options.readOnly ? 'read-only' : 'workspace-write';
    const args = ['exec', JSON.stringify(options.prompt), '--json', '--sandbox', sandboxMode];
    if (options.model) {
      args.push('--model', options.model);
    }

    log(`Spawning codex`, { args: args.slice(0, 5), cwd: options.cwd });

    const env = getShellEnv();
    const proc = spawn('codex', args, { cwd: options.cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });

    const state: RunState = { process: proc, messageCount: 0, timeout: options.timeoutMs, maxTurns: options.maxTurns };
    this.runningStates.set(runId, state);

    let resultText = '';
    let isError = false;
    let errorMessage: string | undefined;
    let structuredOutput: Record<string, unknown> | undefined;

    const emit = (chunk: string) => {
      resultText += chunk;
      onOutput?.(chunk);
    };

    // Timeout handling
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
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
              if (msg.type === 'message' || msg.type === 'text') {
                const text = (msg.content ?? msg.text ?? '') as string;
                emit(text + '\n');
                onMessage?.({ type: 'assistant_text', text, timestamp: Date.now() });
              } else if (msg.type === 'function_call' || msg.type === 'tool_use') {
                const toolName = (msg.name ?? msg.function ?? 'unknown') as string;
                const input = JSON.stringify(msg.arguments ?? msg.input ?? {});
                emit(`\n> Tool: ${toolName}\n> Input: ${input.slice(0, 2000)}\n`);
                onMessage?.({ type: 'tool_use', toolName, input: input.slice(0, 2000), timestamp: Date.now() });
              } else if (msg.type === 'function_call_output' || msg.type === 'tool_result') {
                const result = typeof msg.output === 'string' ? msg.output : JSON.stringify(msg.output ?? msg.result ?? '');
                onMessage?.({ type: 'tool_result', result: result.slice(0, 2000), timestamp: Date.now() });
              } else if (msg.type === 'error') {
                isError = true;
                errorMessage = (msg.message ?? msg.error ?? 'Unknown error') as string;
                emit(`[error] ${errorMessage}\n`);
              } else if (msg.type === 'result') {
                if (msg.structured_output) {
                  structuredOutput = msg.structured_output as Record<string, unknown>;
                }
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

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (state.killTimer) clearTimeout(state.killTimer);
        this.runningStates.delete(runId);

        if (timedOut) {
          isError = true;
          errorMessage = `codex timed out after ${Math.round(options.timeoutMs / 1000)}s`;
          log(errorMessage);
        } else if (code !== 0 && !isError) {
          isError = true;
          errorMessage = stderrOutput || `codex exited with code ${code}`;
          log(`codex failed: ${errorMessage}`);
        }

        log(`codex completed: exitCode=${code}, messages=${state.messageCount}`);

        resolve({
          exitCode: isError ? 1 : 0,
          output: resultText || errorMessage || '',
          error: isError ? errorMessage : undefined,
          structuredOutput,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (state.killTimer) clearTimeout(state.killTimer);
        this.runningStates.delete(runId);
        isError = true;
        errorMessage = `Failed to spawn codex: ${err.message}`;
        log(errorMessage);
        resolve({
          exitCode: 1,
          output: resultText || errorMessage,
          error: errorMessage,
        });
      });
    });
  }

  async stop(runId: string): Promise<void> {
    const state = this.runningStates.get(runId);
    if (!state) {
      console.warn(`[CodexCliLib] stop called for unknown runId: ${runId}`);
      return;
    }
    try { process.kill(-state.process.pid!, 'SIGTERM'); } catch { state.process.kill('SIGTERM'); }
    state.killTimer = setTimeout(() => { try { process.kill(-state.process.pid!, 'SIGKILL'); } catch { /* process already exited */ } }, 5000);
    this.runningStates.delete(runId);
  }
}
