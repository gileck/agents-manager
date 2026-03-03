import type { AutomatedAgent, Project } from '../../shared/types';

export interface IAutomatedAgentPromptBuilder {
  readonly templateId: string;
  buildContext(agent: AutomatedAgent, project: Project): Promise<string>;
}
