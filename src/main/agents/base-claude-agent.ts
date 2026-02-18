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

  buildResult(exitCode: number, output: string, outcome: string, error?: string, costInputTokens?: number, costOutputTokens?: number): AgentRunResult {
    return { exitCode, output, outcome, error, costInputTokens, costOutputTokens };
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

  async execute(context: AgentContext, config: AgentConfig, onOutput?: (chunk: string) => void, onLog?: (message: string, data?: Record<string, unknown>) => void): Promise<AgentRunResult> {
    const log = (msg: string, data?: Record<string, unknown>) => onLog?.(msg, data);
    const query = await this.loadQuery();

    let prompt = this.buildPrompt(context);
    if (context.taskContext?.length) {
      const block = context.taskContext.map(e => {
        const ts = new Date(e.createdAt).toISOString();
        return `### [${e.source}] ${e.entryType} (${ts})\n${e.summary}`;
      }).join('\n\n');
      prompt = `## Task Context\n\n${block}\n\n---\n\n${prompt}`;
    }
    const workdir = context.workdir;
    const timeout = this.getTimeout(context, config);

    const abortController = new AbortController();
    const runId = context.task.id;
    this.runningAbortControllers.set(runId, abortController);

    const timer = setTimeout(() => abortController.abort(), timeout);

    let resultText = '';
    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;
    let isError = false;
    let errorMessage: string | undefined;
    let messageCount = 0;

    const emit = (chunk: string) => {
      resultText += chunk;
      onOutput?.(chunk);
    };

    log(`Starting agent run: mode=${context.mode}, workdir=${workdir}, timeout=${timeout}ms`);
    log(`Prompt: ${prompt.slice(0, 200)}`);

    try {
      for await (const message of query({
        prompt,
        options: {
          cwd: workdir,
          abortController,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
        },
      })) {
        messageCount++;
        const msg = message as any;

        log(`Message #${messageCount}: type="${message.type}" | keys: ${Object.keys(message).join(', ')}`);

        if (message.type === 'assistant') {
          const content = msg.message?.content ?? [];
          log(`  assistant content blocks: ${content.length}`);
          for (const block of content) {
            log(`  block type="${block.type}" ${block.type === 'text' ? `text_length=${block.text.length}` : block.type === 'tool_use' ? `tool="${block.name}"` : ''}`);
            if ('text' in block && typeof block.text === 'string') {
              emit(block.text + '\n');
            } else if (block.type === 'tool_use') {
              const input = JSON.stringify(block.input ?? {});
              emit(`\n> Tool: ${block.name}\n> Input: ${input.slice(0, 500)}${input.length > 500 ? '...' : ''}\n`);
            }
          }
        } else if (message.type === 'result') {
          log(`  result subtype="${msg.subtype}" result_length=${msg.result?.length ?? 0}`);
          if (msg.subtype !== 'success') {
            isError = true;
            errorMessage = msg.errors?.join('\n') || 'Agent execution failed';
          }
          costInputTokens = msg.usage?.input_tokens;
          costOutputTokens = msg.usage?.output_tokens;
        } else {
          const json = JSON.stringify(message);
          log(`  UNHANDLED type="${message.type}" payload(${json.length} chars): ${json.slice(0, 500)}`);
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

        log(`  resultText total length: ${resultText.length}`);
      }
    } catch (err) {
      isError = true;
      errorMessage = err instanceof Error ? err.message : String(err);
      log(`Error during execution: ${errorMessage}`);
    } finally {
      clearTimeout(timer);
      this.runningAbortControllers.delete(runId);
    }

    const exitCode = isError ? 1 : 0;
    const outcome = this.inferOutcome(context.mode, exitCode, resultText);

    log(`Run complete: messages=${messageCount}, exitCode=${exitCode}, outcome=${outcome}, output_length=${resultText.length}`);
    log(`Output first 300 chars: ${resultText.slice(0, 300)}`);
    log(`Output last 300 chars: ${resultText.slice(-300)}`);

    const output = resultText || errorMessage || '';
    return this.buildResult(exitCode, output, outcome, isError ? errorMessage : undefined, costInputTokens, costOutputTokens);
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
