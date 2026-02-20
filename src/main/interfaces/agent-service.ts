import type { AgentRun, AgentMode, AgentChatMessage } from '../../shared/types';

export interface IAgentService {
  execute(taskId: string, mode: AgentMode, agentType: string, onOutput?: (chunk: string) => void, onMessage?: (msg: AgentChatMessage) => void, onStatusChange?: (status: string) => void): Promise<AgentRun>;
  queueMessage(taskId: string, message: string): void;
  waitForCompletion(runId: string): Promise<void>;
  stop(runId: string): Promise<void>;
  recoverOrphanedRuns(): Promise<AgentRun[]>;
  getActiveRunIds(): string[];
}
