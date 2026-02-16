import type { AgentInfo } from '../../shared/types';
import type { IAgent } from '../interfaces/agent';
import type { IAgentFramework } from '../interfaces/agent-framework';

export class AgentFrameworkImpl implements IAgentFramework {
  private agents = new Map<string, IAgent>();

  registerAgent(agent: IAgent): void {
    this.agents.set(agent.type, agent);
  }

  getAgent(type: string): IAgent {
    const agent = this.agents.get(type);
    if (!agent) {
      throw new Error(`Agent type not registered: ${type}`);
    }
    return agent;
  }

  listAgents(): AgentInfo[] {
    return Array.from(this.agents.values()).map((a) => ({
      type: a.type,
      name: a.type,
      description: `Agent: ${a.type}`,
      available: false,
    }));
  }

  async getAvailableAgents(): Promise<AgentInfo[]> {
    const results: AgentInfo[] = [];
    for (const agent of this.agents.values()) {
      const available = await agent.isAvailable();
      results.push({
        type: agent.type,
        name: agent.type,
        description: `Agent: ${agent.type}`,
        available,
      });
    }
    return results;
  }
}
