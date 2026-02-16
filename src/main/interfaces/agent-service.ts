import type { AgentRun, AgentMode } from '../../shared/types';

export interface IAgentService {
  execute(taskId: string, mode: AgentMode, agentType: string, onOutput?: (chunk: string) => void): Promise<AgentRun>;
  waitForCompletion(runId: string): Promise<void>;
  stop(runId: string): Promise<void>;
}
