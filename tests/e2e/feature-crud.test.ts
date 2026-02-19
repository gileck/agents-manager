import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createFeatureInput, createTaskInput, resetCounters } from '../helpers/factories';

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
});
