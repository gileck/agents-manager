import type { AgentChatMessage } from '../../shared/types';

export interface ISessionHistoryProvider {
  /** Load messages from the most recent prior run for the same task+agentType */
  getPreviousMessages(taskId: string, agentType: string): Promise<AgentChatMessage[] | null>;
}
