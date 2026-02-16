import type { AgentRun, AgentMode } from '../../shared/types';

export interface IAgentService {
  execute(taskId: string, mode: AgentMode, agentType: string): Promise<AgentRun>;
  stop(runId: string): Promise<void>;
}
