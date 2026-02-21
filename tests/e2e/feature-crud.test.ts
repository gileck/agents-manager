import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createFeatureInput, createTaskInput, resetCounters } from '../helpers/factories';
import { SIMPLE_PIPELINE } from '../../src/main/data/seeded-pipelines';

describe('Feature CRUD', () => {
  let ctx: TestContext;

  beforeEach(() => {
    resetCounters();
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should create a feature with required fields', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const input = createFeatureInput(project.id);
    const feature = await ctx.featureStore.createFeature(input);

    expect(feature.id).toBeDefined();
    expect(feature.projectId).toBe(project.id);
    expect(feature.title).toBe(input.title);
    expect(feature.description).toBeNull();
    expect(feature.createdAt).toBeGreaterThan(0);
    expect(feature.updatedAt).toBeGreaterThan(0);
  });

  it('should create a feature with description', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const feature = await ctx.featureStore.createFeature(
      createFeatureInput(project.id, { description: 'A detailed description' }),
    );

    expect(feature.description).toBe('A detailed description');
  });

  it('should get a feature by ID', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const created = await ctx.featureStore.createFeature(createFeatureInput(project.id));
    const fetched = await ctx.featureStore.getFeature(created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.title).toBe(created.title);
  });

  it('should return null for non-existent feature', async () => {
    const result = await ctx.featureStore.getFeature('non-existent');
    expect(result).toBeNull();
  });

  it('should list all features without filter', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    await ctx.featureStore.createFeature(createFeatureInput(project.id));
    await ctx.featureStore.createFeature(createFeatureInput(project.id));

    const features = await ctx.featureStore.listFeatures();
    expect(features).toHaveLength(2);
  });

  it('should list features filtered by projectId', async () => {
    const project1 = await ctx.projectStore.createProject(createProjectInput());
    const project2 = await ctx.projectStore.createProject(createProjectInput());
    await ctx.featureStore.createFeature(createFeatureInput(project1.id));
    await ctx.featureStore.createFeature(createFeatureInput(project1.id));
    await ctx.featureStore.createFeature(createFeatureInput(project2.id));

    const filtered = await ctx.featureStore.listFeatures({ projectId: project1.id });
    expect(filtered).toHaveLength(2);
    expect(filtered.every(f => f.projectId === project1.id)).toBe(true);
  });

  it('should update feature title', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const feature = await ctx.featureStore.createFeature(createFeatureInput(project.id));

    const updated = await ctx.featureStore.updateFeature(feature.id, { title: 'New Title' });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('New Title');
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(feature.updatedAt);
  });

  it('should update feature description', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const feature = await ctx.featureStore.createFeature(createFeatureInput(project.id));

    const updated = await ctx.featureStore.updateFeature(feature.id, { description: 'Updated desc' });

    expect(updated).not.toBeNull();
    expect(updated!.description).toBe('Updated desc');
  });

  it('should return null when updating non-existent feature', async () => {
    const result = await ctx.featureStore.updateFeature('non-existent', { title: 'test' });
    expect(result).toBeNull();
  });

  it('should delete a feature', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const feature = await ctx.featureStore.createFeature(createFeatureInput(project.id));

    const deleted = await ctx.featureStore.deleteFeature(feature.id);
    expect(deleted).toBe(true);

    const fetched = await ctx.featureStore.getFeature(feature.id);
    expect(fetched).toBeNull();
  });

  it('should unlink tasks when deleting a feature', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const feature = await ctx.featureStore.createFeature(createFeatureInput(project.id));
    const task = await ctx.taskStore.createTask(
      createTaskInput(project.id, 'pipeline-simple', { featureId: feature.id }),
    );

    expect(task.featureId).toBe(feature.id);

    await ctx.featureStore.deleteFeature(feature.id);

    const updatedTask = await ctx.taskStore.getTask(task.id);
    expect(updatedTask!.featureId).toBeNull();
  });

  it('should return false when deleting non-existent feature', async () => {
    const result = await ctx.featureStore.deleteFeature('non-existent');
    expect(result).toBe(false);
  });

  it('should unlink all tasks when deleting a feature with multiple linked tasks', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const feature = await ctx.featureStore.createFeature(createFeatureInput(project.id));

    const task1 = await ctx.taskStore.createTask(
      createTaskInput(project.id, SIMPLE_PIPELINE.id, { featureId: feature.id }),
    );
    const task2 = await ctx.taskStore.createTask(
      createTaskInput(project.id, SIMPLE_PIPELINE.id, { featureId: feature.id }),
    );
    const task3 = await ctx.taskStore.createTask(
      createTaskInput(project.id, SIMPLE_PIPELINE.id, { featureId: feature.id }),
    );

    // Verify all tasks are linked to the feature
    expect(task1.featureId).toBe(feature.id);
    expect(task2.featureId).toBe(feature.id);
    expect(task3.featureId).toBe(feature.id);

    await ctx.featureStore.deleteFeature(feature.id);

    // All tasks should have featureId set to null
    const updatedTask1 = await ctx.taskStore.getTask(task1.id);
    const updatedTask2 = await ctx.taskStore.getTask(task2.id);
    const updatedTask3 = await ctx.taskStore.getTask(task3.id);

    expect(updatedTask1!.featureId).toBeNull();
    expect(updatedTask2!.featureId).toBeNull();
    expect(updatedTask3!.featureId).toBeNull();

    // Tasks should still exist (not deleted)
    expect(updatedTask1).not.toBeNull();
    expect(updatedTask2).not.toBeNull();
    expect(updatedTask3).not.toBeNull();
  });

  it('should not change task status when feature is deleted (only featureId is unlinked)', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const feature = await ctx.featureStore.createFeature(createFeatureInput(project.id));

    const task = await ctx.taskStore.createTask(
      createTaskInput(project.id, SIMPLE_PIPELINE.id, { featureId: feature.id }),
    );

    // Transition the task to in_progress so it's not in the default status
    await ctx.transitionTo(task.id, 'in_progress');
    const inProgressTask = await ctx.taskStore.getTask(task.id);
    expect(inProgressTask!.status).toBe('in_progress');

    // Delete the feature
    await ctx.featureStore.deleteFeature(feature.id);

    // Task status should remain unchanged (still in_progress)
    const updatedTask = await ctx.taskStore.getTask(task.id);
    expect(updatedTask!.featureId).toBeNull();
    expect(updatedTask!.status).toBe('in_progress');
  });
});
