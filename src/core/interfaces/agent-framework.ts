import type { AgentInfo } from '../../shared/types';
import type { IAgent } from './agent';

export interface IAgentFramework {
  getAgent(type: string): IAgent;
  listAgents(): AgentInfo[];
  getAvailableAgents(): Promise<AgentInfo[]>;
  registerAgent(agent: IAgent): void;
}
