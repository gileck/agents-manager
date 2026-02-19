import type { AgentDefinition, AgentDefinitionCreateInput, AgentDefinitionUpdateInput } from '../../shared/types';

export interface IAgentDefinitionStore {
  getDefinition(id: string): Promise<AgentDefinition | null>;
  listDefinitions(): Promise<AgentDefinition[]>;
  getDefinitionByAgentType(agentType: string): Promise<AgentDefinition | null>;
  getDefinitionByMode(mode: string): Promise<AgentDefinition | null>;
  createDefinition(input: AgentDefinitionCreateInput): Promise<AgentDefinition>;
  updateDefinition(id: string, input: AgentDefinitionUpdateInput): Promise<AgentDefinition | null>;
  deleteDefinition(id: string): Promise<boolean>;
}
