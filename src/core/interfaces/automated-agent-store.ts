import type { AutomatedAgent, AutomatedAgentCreateInput, AutomatedAgentUpdateInput } from '../../shared/types';

export interface IAutomatedAgentStore {
  getAgent(id: string): Promise<AutomatedAgent | null>;
  listAgents(projectId?: string): Promise<AutomatedAgent[]>;
  listDueAgents(nowMs: number): Promise<AutomatedAgent[]>;
  createAgent(input: AutomatedAgentCreateInput): Promise<AutomatedAgent>;
  updateAgent(id: string, input: AutomatedAgentUpdateInput): Promise<AutomatedAgent | null>;
  deleteAgent(id: string): Promise<boolean>;
  recordRun(id: string, runAt: number, status: string, nextRunAt: number | null): Promise<void>;
  setNextRunAt(id: string, nextRunAt: number | null): Promise<void>;
}
