import type { AgentContext, AgentConfig, AgentRunResult } from '../../shared/types';
import type { IAgent } from '../interfaces/agent';

export class ClaudeCodeAgent implements IAgent {
  readonly type = 'claude-code';

  async execute(context: AgentContext, config: AgentConfig): Promise<AgentRunResult> {
    try {
      // Dynamic import — module may not be installed
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sdk = await (Function('return import("@anthropic-ai/claude-code")')() as Promise<{ query: (...args: unknown[]) => Promise<Array<{ content: string }>> }>);

      const result = await sdk.query({
        prompt: context.systemPrompt ?? config.systemPrompt ?? `You are working on task: ${context.task.title}`,
        options: {
          maxTurns: 10,
        },
      });

      const output = result.map((r: { content: string }) => r.content).join('\n');
      return {
        exitCode: 0,
        output,
        outcome: 'completed',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        exitCode: 1,
        output: '',
        outcome: 'failed',
        error: message,
      };
    }
  }

  async stop(_runId: string): Promise<void> {
    // abort not yet implemented
  }

  async isAvailable(): Promise<boolean> {
    try {
      await (Function('return import("@anthropic-ai/claude-code")')() as Promise<unknown>);
      return true;
    } catch {
      return false;
    }
  }
}
