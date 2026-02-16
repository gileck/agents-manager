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

  async execute(context: AgentContext, config: AgentConfig, onOutput?: (chunk: string) => void): Promise<AgentRunResult> {
    const query = await this.loadQuery();

    const prompt = this.buildPrompt(context);
    const workdir = context.project?.path || context.workdir;
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
        if (message.type === 'assistant') {
          // Extract text from assistant message content blocks
          for (const block of message.message.content) {
            if ('text' in block && typeof block.text === 'string') {
              onOutput?.(block.text);
            }
          }
        } else if (message.type === 'result') {
          if (message.subtype === 'success') {
            resultText = message.result;
          } else {
            isError = true;
            errorMessage = message.errors?.join('\n') || 'Agent execution failed';
          }
          costInputTokens = message.usage.input_tokens;
          costOutputTokens = message.usage.output_tokens;
        }
      }
    } catch (err) {
      isError = true;
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
      this.runningAbortControllers.delete(runId);
    }

    const exitCode = isError ? 1 : 0;
    const outcome = this.inferOutcome(context.mode, exitCode);

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
        return `Implement the changes for this task. Task: ${task.title}.${desc}`;
      case 'review':
        return `Review the changes for this task. Task: ${task.title}.${desc}`;
      default:
        return `${task.title}.${desc}`;
    }
  }
}
