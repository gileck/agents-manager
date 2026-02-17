import type { AgentContext, AgentConfig, AgentRunResult } from '../../shared/types';

export interface IAgent {
  readonly type: string;
  execute(context: AgentContext, config: AgentConfig, onOutput?: (chunk: string) => void, onLog?: (message: string, data?: Record<string, unknown>) => void): Promise<AgentRunResult>;
  stop(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
