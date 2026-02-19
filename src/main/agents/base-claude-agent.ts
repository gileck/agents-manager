import type { AgentContext, AgentConfig, AgentRunResult } from '../../shared/types';
import type { IAgent } from '../interfaces/agent';

// Use Function constructor to preserve dynamic import() at runtime.
// TypeScript compiles `await import(...)` to `require()` under CommonJS,
// but the SDK is ESM-only (.mjs). This bypasses that transformation.
const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

export abstract class BaseClaudeAgent implements IAgent {
  abstract readonly type: string;

  private runningAbortControllers = new Map<string, AbortController>();

  abstract buildPrompt(context: AgentContext): string;
  abstract inferOutcome(mode: string, exitCode: number, output: string): string;

  /** Override in subclass to limit the number of SDK turns. */
  protected getMaxTurns(_context: AgentContext): number {
    return 100;
  }

  /** Override in subclass to request structured JSON output from the SDK. */
  protected getOutputFormat(_context: AgentContext): object | undefined {
    return undefined;
  }

  buildResult(exitCode: number, output: string, outcome: string, error?: string, costInputTokens?: number, costOutputTokens?: number, structuredOutput?: Record<string, unknown>, prompt?: string): AgentRunResult {
    return { exitCode, output, outcome, error, costInputTokens, costOutputTokens, structuredOutput, prompt };
  }

  protected getTimeout(context: AgentContext, config: AgentConfig): number {
    return config.timeout || 10 * 60 * 1000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const query = await this.loadQuery();
      return !!query;
    } catch {
      return false;
    }
  }

  async execute(context: AgentContext, config: AgentConfig, onOutput?: (chunk: string) => void, onLog?: (message: string, data?: Record<string, unknown>) => void, onPromptBuilt?: (prompt: string) => void): Promise<AgentRunResult> {
    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);
    const query = await this.loadQuery();

    let prompt = context.resolvedPrompt ?? this.buildPrompt(context);
    if (context.taskContext?.length) {
      const block = context.taskContext.map(e => {
        const ts = new Date(e.createdAt).toISOString();
        return `### [${e.source}] ${e.entryType} (${ts})\n${e.summary}`;
      }).join('\n\n');
      prompt = `## Task Context\n\n${block}\n\n---\n\n${prompt}`;
    }
    onPromptBuilt?.(prompt);
    const workdir = context.workdir;
    const timeout = this.getTimeout(context, config);

    const abortController = new AbortController();
    const runId = context.task.id;
    this.runningAbortControllers.set(runId, abortController);

    const timer = setTimeout(() => abortController.abort(), timeout);

    let resultText = '';
    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;
    let structuredOutput: Record<string, unknown> | undefined;
    let isError = false;
    let errorMessage: string | undefined;
    let messageCount = 0;

    const emit = (chunk: string) => {
      resultText += chunk;
      onOutput?.(chunk);
    };

    log(`Starting agent run: mode=${context.mode}, workdir=${workdir}, timeout=${timeout}ms, model=${config.model ?? 'default'}`);

    const outputFormat = this.getOutputFormat(context);
    const maxTurns = this.getMaxTurns(context);

    log(`Entering SDK message loop`, {
      promptLength: prompt.length,
      model: config.model ?? 'default',
      maxTurns,
      hasOutputFormat: !!outputFormat,
    });

    try {
      for await (const message of query({
        prompt,
        options: {
          cwd: workdir,
          abortController,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          model: config.model,
          maxTurns,
          ...(outputFormat ? { outputFormat } : {}),
        },
      })) {
        messageCount++;
        if (messageCount % 25 === 0) {
          log(`SDK message loop heartbeat: ${messageCount} messages processed`);
        }
        const msg = message as any;

        if (message.type === 'assistant') {
          const content = msg.message?.content ?? [];
          for (const block of content) {
            if ('text' in block && typeof block.text === 'string') {
              emit(block.text + '\n');
            } else if (block.type === 'tool_use') {
              const input = JSON.stringify(block.input ?? {});
              log(`Tool: ${block.name} | Input: ${input.slice(0, 1000)}${input.length > 1000 ? '...' : ''}`);
              emit(`\n> Tool: ${block.name}\n> Input: ${input.slice(0, 2000)}${input.length > 2000 ? '...' : ''}\n`);
            }
          }
        } else if (message.type === 'result') {
          if (msg.subtype !== 'success') {
            isError = true;
            errorMessage = msg.errors?.join('\n') || 'Agent execution failed';
          }
          if (msg.structured_output) {
            structuredOutput = msg.structured_output;
          }
          costInputTokens = msg.usage?.input_tokens;
          costOutputTokens = msg.usage?.output_tokens;
        } else {
          if (msg.message?.content) {
            for (const block of msg.message.content) {
              if ('text' in block && typeof block.text === 'string') {
                emit(`[${message.type}] ${block.text}\n`);
              }
            }
          } else if (typeof msg.summary === 'string') {
            emit(`[${message.type}] ${msg.summary}\n`);
          } else if (typeof msg.result === 'string') {
            emit(`[${message.type}] ${msg.result}\n`);
          }
        }
      }
      log(`SDK message loop completed: ${messageCount} messages, hasStructuredOutput=${!!structuredOutput}, isError=${isError}`);
    } catch (err) {
      isError = true;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      errorMessage = err instanceof Error ? err.message : String(err);
      if (isAbort) {
        log(`Agent timed out after ${timeout}ms (${messageCount} messages processed)`);
      } else {
        log(`Agent execution error: ${errorMessage}`);
      }
    } finally {
      clearTimeout(timer);
      this.runningAbortControllers.delete(runId);
    }

    const exitCode = isError ? 1 : 0;
    const outcome = this.inferOutcome(context.mode, exitCode, resultText);

    log(`Agent returning: exitCode=${exitCode}, outcome=${outcome}, outputLength=${resultText.length}, hasStructuredOutput=${!!structuredOutput}`);

    const output = resultText || errorMessage || '';
    return this.buildResult(exitCode, output, outcome, isError ? errorMessage : undefined, costInputTokens, costOutputTokens, structuredOutput, prompt);
  }

  async stop(runId: string): Promise<void> {
    const controller = this.runningAbortControllers.get(runId);
    if (!controller) return;

    controller.abort();
    this.runningAbortControllers.delete(runId);
  }

  protected async loadQuery(): Promise<any> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    return mod.query;
  }
}
