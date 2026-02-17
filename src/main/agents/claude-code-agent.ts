import type { AgentContext, AgentConfig, AgentRunResult } from '../../shared/types';
import type { IAgent } from '../interfaces/agent';

// Use Function constructor to preserve dynamic import() at runtime.
// TypeScript compiles `await import(...)` to `require()` under CommonJS,
// but the SDK is ESM-only (.mjs). This bypasses that transformation.
const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

export class ClaudeCodeAgent implements IAgent {
  readonly type = 'claude-code';
  private runningAbortControllers = new Map<string, AbortController>();

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

    const prompt = this.buildPrompt(context);
    const workdir = context.workdir;
    const timeout = config.timeout || (context.mode === 'plan' ? 5 * 60 * 1000 : 10 * 60 * 1000);

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
          // Log any other message type fully so we know what the SDK yields
          const json = JSON.stringify(message);
          log(`  UNHANDLED type="${message.type}" payload(${json.length} chars): ${json.slice(0, 500)}`);
          // Still emit something so the user sees it
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
    const outcome = this.inferOutcome(context.mode, exitCode);

    log(`Run complete: messages=${messageCount}, exitCode=${exitCode}, outcome=${outcome}, output_length=${resultText.length}`);
    log(`Output first 300 chars: ${resultText.slice(0, 300)}`);
    log(`Output last 300 chars: ${resultText.slice(-300)}`);

    return {
      exitCode,
      output: resultText || errorMessage || '',
      outcome,
      costInputTokens,
      costOutputTokens,
      error: isError ? errorMessage : undefined,
    };
  }

  async stop(runId: string): Promise<void> {
    const controller = this.runningAbortControllers.get(runId);
    if (!controller) return;

    controller.abort();
    this.runningAbortControllers.delete(runId);
  }

  private async loadQuery(): Promise<any> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    return mod.query;
  }

  private inferOutcome(mode: string, exitCode: number): string {
    if (exitCode !== 0) return 'failed';
    switch (mode) {
      case 'plan': return 'plan_complete';
      case 'implement': return 'pr_ready';
      case 'review': return 'approved';
      default: return 'completed';
    }
  }

  private buildPrompt(context: AgentContext): string {
    const { task, mode } = context;
    const desc = task.description ? ` ${task.description}` : '';

    switch (mode) {
      case 'plan':
        return `Analyze this task and create a detailed implementation plan. Task: ${task.title}.${desc}`;
      case 'implement':
        return `Implement the changes for this task. After making all changes, stage and commit them with git (git add the relevant files, then git commit with a descriptive message). Task: ${task.title}.${desc}`;
      case 'review':
        return `Review the changes for this task. Task: ${task.title}.${desc}`;
      default:
        return `${task.title}.${desc}`;
    }
  }
}
