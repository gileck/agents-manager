import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { SIMPLE_PIPELINE } from '../../src/main/data/seeded-pipelines';

describe('Task Dependencies', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should add a dependency between tasks', async () => {
    const task1 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    await ctx.taskStore.addDependency(task2.id, task1.id);

    const deps = await ctx.taskStore.getDependencies(task2.id);
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe(task1.id);
  });

  it('should remove a dependency between tasks', async () => {
    const task1 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    await ctx.taskStore.addDependency(task2.id, task1.id);
    await ctx.taskStore.removeDependency(task2.id, task1.id);

    const deps = await ctx.taskStore.getDependencies(task2.id);
    expect(deps).toHaveLength(0);
  });

  it('should get dependents of a task', async () => {
    const task1 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task3 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    await ctx.taskStore.addDependency(task2.id, task1.id);
    await ctx.taskStore.addDependency(task3.id, task1.id);

    const dependents = await ctx.taskStore.getDependents(task1.id);
    expect(dependents).toHaveLength(2);
    const ids = dependents.map((t) => t.id);
    expect(ids).toContain(task2.id);
    expect(ids).toContain(task3.id);
  });

  it('should handle multiple dependencies for a task', async () => {
    const task1 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task3 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    await ctx.taskStore.addDependency(task3.id, task1.id);
    await ctx.taskStore.addDependency(task3.id, task2.id);

    const deps = await ctx.taskStore.getDependencies(task3.id);
    expect(deps).toHaveLength(2);
    const ids = deps.map((t) => t.id);
    expect(ids).toContain(task1.id);
    expect(ids).toContain(task2.id);
  });

  it('should not duplicate dependencies', async () => {
    const task1 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    await ctx.taskStore.addDependency(task2.id, task1.id);
    await ctx.taskStore.addDependency(task2.id, task1.id); // duplicate

    const deps = await ctx.taskStore.getDependencies(task2.id);
    expect(deps).toHaveLength(1);
  });

  it('should clean up dependencies when task is deleted', async () => {
    const task1 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const task2 = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    await ctx.taskStore.addDependency(task2.id, task1.id);
    await ctx.taskStore.deleteTask(task1.id);

    const deps = await ctx.taskStore.getDependencies(task2.id);
    expect(deps).toHaveLength(0);
  });

  // NOTE: system currently allows circular dependencies - these tests document the behavior.
  // addDependency uses INSERT OR IGNORE so circular deps are silently accepted.

  it('should allow self-dependency (documents current behavior)', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    // Self-dependency is not prevented by the system
    await ctx.taskStore.addDependency(task.id, task.id);

    const deps = await ctx.taskStore.getDependencies(task.id);
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe(task.id);
  });

  it('should allow direct circular dependency A→B→A (documents current behavior)', async () => {
    const taskA = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const taskB = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    await ctx.taskStore.addDependency(taskA.id, taskB.id); // A depends on B
    // Adding reverse dependency is not prevented
    await ctx.taskStore.addDependency(taskB.id, taskA.id); // B depends on A

    const depsA = await ctx.taskStore.getDependencies(taskA.id);
    expect(depsA).toHaveLength(1);
    expect(depsA[0].id).toBe(taskB.id);

    const depsB = await ctx.taskStore.getDependencies(taskB.id);
    expect(depsB).toHaveLength(1);
    expect(depsB[0].id).toBe(taskA.id);
  });

  it('should allow transitive circular dependency A→B→C→A (documents current behavior)', async () => {
    const taskA = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const taskB = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const taskC = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    await ctx.taskStore.addDependency(taskA.id, taskB.id); // A depends on B
    await ctx.taskStore.addDependency(taskB.id, taskC.id); // B depends on C
    // Closing the cycle is not prevented
    await ctx.taskStore.addDependency(taskC.id, taskA.id); // C depends on A

    const depsA = await ctx.taskStore.getDependencies(taskA.id);
    expect(depsA).toHaveLength(1);
    expect(depsA[0].id).toBe(taskB.id);

    const depsC = await ctx.taskStore.getDependencies(taskC.id);
    expect(depsC).toHaveLength(1);
    expect(depsC[0].id).toBe(taskA.id);
  });

  it('should still accept valid dependencies after a circular dependency', async () => {
    const taskA = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const taskB = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const taskC = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    // Create circular dependency A→B→A
    await ctx.taskStore.addDependency(taskA.id, taskB.id);
    await ctx.taskStore.addDependency(taskB.id, taskA.id);

    // Adding a valid dependency should still work
    await ctx.taskStore.addDependency(taskC.id, taskA.id);

    const depsC = await ctx.taskStore.getDependencies(taskC.id);
    expect(depsC).toHaveLength(1);
    expect(depsC[0].id).toBe(taskA.id);
  });
});
