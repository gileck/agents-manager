import type { AgentRun, AgentRunCreateInput, AgentRunUpdateInput } from '../../shared/types';

export interface IAgentRunStore {
  createRun(input: AgentRunCreateInput): Promise<AgentRun>;
  updateRun(id: string, input: AgentRunUpdateInput): Promise<AgentRun | null>;
  getRun(id: string): Promise<AgentRun | null>;
  getRunsForTask(taskId: string): Promise<AgentRun[]>;
  getActiveRuns(): Promise<AgentRun[]>;
  /**
   * Returns agent runs, ordered by startedAt descending.
   * @param limit - Maximum number of rows to return. If omitted, returns all runs.
   */
  getAllRuns(limit?: number): Promise<AgentRun[]>;
  getRunsForAutomatedAgent(automatedAgentId: string, limit?: number): Promise<AgentRun[]>;
  getActiveRunForAutomatedAgent(automatedAgentId: string): Promise<AgentRun | null>;
  countFailedRunsSync(taskId: string, agentType?: string): number;
  countRunningRunsSync(taskId: string): number;
}
