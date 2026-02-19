import type { ProjectCreateInput, TaskCreateInput, AgentRunCreateInput, AgentMode, FeatureCreateInput, AgentDefinitionCreateInput, TaskContextEntryCreateInput } from '../../src/shared/types';

let projectCounter = 0;
let taskCounter = 0;
let featureCounter = 0;

export function resetCounters(): void {
  projectCounter = 0;
  taskCounter = 0;
  featureCounter = 0;
}

export function createProjectInput(overrides?: Partial<ProjectCreateInput>): ProjectCreateInput {
  projectCounter++;
  return {
    name: `Test Project ${projectCounter}`,
    description: `Description for project ${projectCounter}`,
    path: '/tmp/test-project',
    ...overrides,
  };
}

export function createTaskInput(
  projectId: string,
  pipelineId: string,
  overrides?: Partial<TaskCreateInput>,
): TaskCreateInput {
  taskCounter++;
  return {
    projectId,
    pipelineId,
    title: `Test Task ${taskCounter}`,
    description: `Description for task ${taskCounter}`,
    ...overrides,
  };
}

export function createAgentRunInput(
  taskId: string,
  overrides?: Partial<Omit<AgentRunCreateInput, 'taskId'>>,
): AgentRunCreateInput {
  return {
    taskId,
    agentType: 'scripted',
    mode: 'plan' as AgentMode,
    ...overrides,
  };
}

export function createFeatureInput(
  projectId: string,
  overrides?: Partial<FeatureCreateInput>,
): FeatureCreateInput {
  featureCounter++;
  return {
    projectId,
    title: `Test Feature ${featureCounter}`,
    ...overrides,
  };
}

export function createAgentDefinitionInput(
  overrides?: Partial<AgentDefinitionCreateInput>,
): AgentDefinitionCreateInput {
  return {
    name: 'Custom Agent',
    engine: 'claude-code',
    modes: [{ mode: 'plan', promptTemplate: 'Plan: {taskTitle}' }],
    ...overrides,
  };
}

export function createTaskContextInput(
  taskId: string,
  overrides?: Partial<TaskContextEntryCreateInput>,
): TaskContextEntryCreateInput {
  return {
    taskId,
    source: 'agent',
    entryType: 'observation',
    summary: 'Test context entry',
    ...overrides,
  };
}
