import type { AgentContext, AgentConfig, AgentRunResult } from '../../shared/types';
import type { IAgent } from '../interfaces/agent';

export type AgentScript = (context: AgentContext, config: AgentConfig) => Promise<AgentRunResult>;

export const happyPlan: AgentScript = async () => ({
  exitCode: 0,
  output: 'Plan generated successfully',
  outcome: 'plan_complete',
  payload: { plan: ['step1', 'step2', 'step3'] },
});

export const happyImplement: AgentScript = async () => ({
  exitCode: 0,
  output: 'Implementation complete',
  outcome: 'pr_ready',
  payload: { filesChanged: 3 },
});

export const happyReview: AgentScript = async () => ({
  exitCode: 0,
  output: 'Review approved',
  outcome: 'approved',
});

export function failAfterSteps(n: number): AgentScript {
  let calls = 0;
  return async () => {
    calls++;
    if (calls >= n) {
      return { exitCode: 1, output: `Failed after ${n} steps`, outcome: 'failed', error: `Simulated failure after ${n} steps` };
    }
    return { exitCode: 0, output: `Step ${calls} ok`, outcome: 'step_complete' };
  };
}

export const humanInTheLoop: AgentScript = async () => ({
  exitCode: 0,
  output: 'Need more information',
  outcome: 'needs_info',
  payload: { questions: ['What is the expected behavior?', 'What environment?'] },
});

export class ScriptedAgent implements IAgent {
  readonly type: string;
  private script: AgentScript;
  private outputChunks: string[] = [];

  constructor(defaultScript: AgentScript, type: string = 'scripted') {
    this.type = type;
    this.script = defaultScript;
  }

  setScript(script: AgentScript): void {
    this.script = script;
  }

  setOutputChunks(chunks: string[]): void {
    this.outputChunks = chunks;
  }

  async execute(context: AgentContext, config: AgentConfig, onOutput?: (chunk: string) => void, _onLog?: (message: string, data?: Record<string, unknown>) => void, _onPromptBuilt?: (prompt: string) => void, _onMessage?: unknown): Promise<AgentRunResult> {
    if (onOutput && this.outputChunks.length > 0) {
      for (const chunk of this.outputChunks) {
        onOutput(chunk);
      }
    }
    return this.script(context, config);
  }

  async stop(_runId: string): Promise<void> {
    // no-op for scripted agent
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
