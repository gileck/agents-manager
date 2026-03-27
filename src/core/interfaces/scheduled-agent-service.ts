import type { AutomatedAgent, AgentRun } from '../../shared/types';
import type { AgentLibCallbacks } from './agent-lib';

export interface IScheduledAgentService {
  triggerRun(
    agent: AutomatedAgent,
    triggeredBy: 'scheduler' | 'manual',
    onOutput?: (chunk: string) => void,
    onMessage?: AgentLibCallbacks['onMessage'],
  ): Promise<AgentRun>;
}
