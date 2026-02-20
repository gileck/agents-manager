import type { AgentRun, AgentRunCreateInput, AgentRunUpdateInput } from '../../shared/types';

export interface IAgentRunStore {
  createRun(input: AgentRunCreateInput): Promise<AgentRun>;
  updateRun(id: string, input: AgentRunUpdateInput): Promise<AgentRun | null>;
  getRun(id: string): Promise<AgentRun | null>;
  getRunsForTask(taskId: string): Promise<AgentRun[]>;
  getActiveRuns(): Promise<AgentRun[]>;
  getAllRuns(): Promise<AgentRun[]>;
}
