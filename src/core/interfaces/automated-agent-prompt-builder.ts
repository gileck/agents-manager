import type { AutomatedAgent, Project } from '../../shared/types';

export interface IAutomatedAgentPromptBuilder {
  readonly templateId: string;
  buildContext(agent: AutomatedAgent, project: Project): Promise<string>;
  /** Optional JSON schema for structured output. When provided, overrides the default report schema. */
  getOutputFormat?(): object;
}
