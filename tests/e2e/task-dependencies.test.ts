import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { SIMPLE_PIPELINE } from '../../src/main/data/seeded-pipelines';

describe('Task Dependencies', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeEach(() => {
    resetCounters();
    ctx = createTestContext();
    const project = ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should add a dependency between tasks', () => {
    const task1 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    ctx.taskStore.addDependency(task2.id, task1.id);

    const deps = ctx.taskStore.getDependencies(task2.id);
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe(task1.id);
  });

  it('should remove a dependency between tasks', () => {
    const task1 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    ctx.taskStore.addDependency(task2.id, task1.id);
    ctx.taskStore.removeDependency(task2.id, task1.id);

    const deps = ctx.taskStore.getDependencies(task2.id);
    expect(deps).toHaveLength(0);
  });

  it('should get dependents of a task', () => {
    const task1 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task3 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    ctx.taskStore.addDependency(task2.id, task1.id);
    ctx.taskStore.addDependency(task3.id, task1.id);

    const dependents = ctx.taskStore.getDependents(task1.id);
    expect(dependents).toHaveLength(2);
    const ids = dependents.map((t) => t.id);
    expect(ids).toContain(task2.id);
    expect(ids).toContain(task3.id);
  });

  it('should handle multiple dependencies for a task', () => {
    const task1 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task3 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    ctx.taskStore.addDependency(task3.id, task1.id);
    ctx.taskStore.addDependency(task3.id, task2.id);

    const deps = ctx.taskStore.getDependencies(task3.id);
    expect(deps).toHaveLength(2);
    const ids = deps.map((t) => t.id);
    expect(ids).toContain(task1.id);
    expect(ids).toContain(task2.id);
  });

  it('should not duplicate dependencies', () => {
    const task1 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    ctx.taskStore.addDependency(task2.id, task1.id);
    ctx.taskStore.addDependency(task2.id, task1.id); // duplicate

    const deps = ctx.taskStore.getDependencies(task2.id);
    expect(deps).toHaveLength(1);
  });

  it('should clean up dependencies when task is deleted', () => {
    const task1 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    ctx.taskStore.addDependency(task2.id, task1.id);
    ctx.taskStore.deleteTask(task1.id);

    const deps = ctx.taskStore.getDependencies(task2.id);
    expect(deps).toHaveLength(0);
  });
});
