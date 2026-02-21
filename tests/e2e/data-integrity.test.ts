import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { SIMPLE_PIPELINE } from '../../src/main/data/seeded-pipelines';

describe('Data Integrity', () => {
  let ctx: TestContext;

  beforeEach(() => {
    resetCounters();
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // Foreign key constraint tests.
  // test-context.ts runs PRAGMA foreign_keys = ON, so these operations should throw.

  it('should throw when creating a task with non-existent projectId', async () => {
    await expect(
      ctx.taskStore.createTask(createTaskInput('non-existent-project', SIMPLE_PIPELINE.id)),
    ).rejects.toThrow();
  });

  it('should throw when creating a task with non-existent pipelineId', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());

    await expect(
      ctx.taskStore.createTask(createTaskInput(project.id, 'non-existent-pipeline')),
    ).rejects.toThrow();
  });

  it('should throw when creating an agent run with non-existent taskId', async () => {
    await expect(
      ctx.agentRunStore.createRun({
        taskId: 'non-existent-task',
        agentType: 'scripted',
        mode: 'plan',
      }),
    ).rejects.toThrow();
  });

  it('should throw when creating an artifact with non-existent taskId', async () => {
    await expect(
      ctx.taskArtifactStore.createArtifact({
        taskId: 'non-existent-task',
        type: 'branch',
        data: { name: 'feature/test' },
      }),
    ).rejects.toThrow();
  });

  it('should throw when creating a dependency between non-existent tasks', async () => {
    await expect(
      ctx.taskStore.addDependency('non-existent-task-1', 'non-existent-task-2'),
    ).rejects.toThrow();
  });

  it('should throw when creating a dependency where only the source task exists', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const task = await ctx.taskStore.createTask(createTaskInput(project.id, SIMPLE_PIPELINE.id));

    await expect(
      ctx.taskStore.addDependency(task.id, 'non-existent-task'),
    ).rejects.toThrow();
  });

  it('should throw when creating a dependency where only the target task exists', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const task = await ctx.taskStore.createTask(createTaskInput(project.id, SIMPLE_PIPELINE.id));

    await expect(
      ctx.taskStore.addDependency('non-existent-task', task.id),
    ).rejects.toThrow();
  });

  it('should throw when creating a feature with non-existent projectId', async () => {
    await expect(
      ctx.featureStore.createFeature({
        projectId: 'non-existent-project',
        title: 'Orphan Feature',
      }),
    ).rejects.toThrow();
  });

  it('should allow creating valid records when all foreign keys exist', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const task = await ctx.taskStore.createTask(createTaskInput(project.id, SIMPLE_PIPELINE.id));

    // All of these should succeed with valid foreign keys
    const run = await ctx.agentRunStore.createRun({
      taskId: task.id,
      agentType: 'scripted',
      mode: 'plan',
    });
    expect(run.taskId).toBe(task.id);

    const artifact = await ctx.taskArtifactStore.createArtifact({
      taskId: task.id,
      type: 'branch',
      data: { name: 'feature/test' },
    });
    expect(artifact.taskId).toBe(task.id);

    const feature = await ctx.featureStore.createFeature({
      projectId: project.id,
      title: 'Valid Feature',
    });
    expect(feature.projectId).toBe(project.id);
  });
});
