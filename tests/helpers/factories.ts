import type { ProjectCreateInput, TaskCreateInput } from '../../src/shared/types';

let projectCounter = 0;
let taskCounter = 0;

export function resetCounters(): void {
  projectCounter = 0;
  taskCounter = 0;
}

export function createProjectInput(overrides?: Partial<ProjectCreateInput>): ProjectCreateInput {
  projectCounter++;
  return {
    name: `Test Project ${projectCounter}`,
    description: `Description for project ${projectCounter}`,
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
