import type { AgentRun, AgentMode, RevisionReason, AgentChatMessage } from '../../shared/types';

export interface IAgentService {
  execute(taskId: string, mode: AgentMode, agentType: string, revisionReason?: RevisionReason, onOutput?: (chunk: string) => void, onMessage?: (msg: AgentChatMessage) => void, onStatusChange?: (status: string) => void): Promise<AgentRun>;
  queueMessage(taskId: string, message: string): void;
  waitForCompletion(runId: string): Promise<void>;
  stop(runId: string): Promise<void>;
  stopAllRunningAgents(): Promise<void>;
  recoverOrphanedRuns(): Promise<AgentRun[]>;
  getActiveRunIds(): string[];
  isSpawning(taskId: string): boolean;
}
