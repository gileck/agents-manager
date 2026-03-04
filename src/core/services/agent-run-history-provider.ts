import type { AgentChatMessage } from '../../shared/types';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { ISessionHistoryProvider } from '../interfaces/session-history-provider';

export class AgentRunHistoryProvider implements ISessionHistoryProvider {
  constructor(private agentRunStore: IAgentRunStore) {}

  async getPreviousMessages(taskId: string, agentType: string): Promise<AgentChatMessage[] | null> {
    const runs = await this.agentRunStore.getRunsForTask(taskId);

    // Find the most recent prior run for the same agentType that has messages
    // Runs are ordered by startedAt descending, so iterate to find the first match
    const prevRun = runs.find(r =>
      r.agentType === agentType &&
      (r.status === 'completed' || r.status === 'failed') &&
      r.messages != null && r.messages.length > 0
    );

    return prevRun?.messages ?? null;
  }
}
