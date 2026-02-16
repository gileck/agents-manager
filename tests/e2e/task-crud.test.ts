import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { SIMPLE_PIPELINE } from '../../src/main/data/seeded-pipelines';

describe('Task CRUD', () => {
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

  it('should create a task with default status from pipeline', async () => {
    const input = createTaskInput(projectId, SIMPLE_PIPELINE.id);
    const task = await ctx.taskStore.createTask(input);

    expect(task.id).toBeDefined();
    expect(task.title).toBe(input.title);
    expect(task.status).toBe('open'); // First status of Simple pipeline
    expect(task.projectId).toBe(projectId);
    expect(task.pipelineId).toBe(SIMPLE_PIPELINE.id);
    expect(task.priority).toBe(0);
    expect(task.tags).toEqual([]);
    expect(task.createdAt).toBeGreaterThan(0);
  });

  it('should create a task with explicit status', async () => {
    const input = createTaskInput(projectId, SIMPLE_PIPELINE.id, { status: 'in_progress' });
    const task = await ctx.taskStore.createTask(input);

    expect(task.status).toBe('in_progress');
  });

  it('should get a task by id', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const fetched = await ctx.taskStore.getTask(task.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(task.id);
    expect(fetched!.title).toBe(task.title);
  });

  it('should return null for non-existent task', async () => {
    const result = await ctx.taskStore.getTask('non-existent-id');
    expect(result).toBeNull();
  });

  it('should list tasks with no filter', async () => {
    await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    const tasks = await ctx.taskStore.listTasks();
    expect(tasks).toHaveLength(2);
  });

  it('should list tasks filtered by projectId', async () => {
    const project2 = await ctx.projectStore.createProject(createProjectInput());
    await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    await ctx.taskStore.createTask(createTaskInput(project2.id, SIMPLE_PIPELINE.id));

    const tasks = await ctx.taskStore.listTasks({ projectId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].projectId).toBe(projectId);
  });

  it('should list tasks filtered by status', async () => {
    await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id, { status: 'in_progress' }));

    const tasks = await ctx.taskStore.listTasks({ status: 'open' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('open');
  });

  it('should list tasks filtered by tag', async () => {
    await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id, { tags: ['frontend', 'urgent'] }));
    await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id, { tags: ['backend'] }));

    const tasks = await ctx.taskStore.listTasks({ tag: 'frontend' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].tags).toContain('frontend');
  });

  it('should update a task', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const updated = await ctx.taskStore.updateTask(task.id, {
      title: 'Updated Title',
      priority: 5,
      tags: ['updated'],
    });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('Updated Title');
    expect(updated!.priority).toBe(5);
    expect(updated!.tags).toEqual(['updated']);
  });

  it('should return null when updating non-existent task', async () => {
    const result = await ctx.taskStore.updateTask('non-existent-id', { title: 'test' });
    expect(result).toBeNull();
  });

  it('should delete a task', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const deleted = await ctx.taskStore.deleteTask(task.id);

    expect(deleted).toBe(true);
    expect(await ctx.taskStore.getTask(task.id)).toBeNull();
  });

  it('should create a task with tags', async () => {
    const input = createTaskInput(projectId, SIMPLE_PIPELINE.id, { tags: ['feature', 'auth'] });
    const task = await ctx.taskStore.createTask(input);

    expect(task.tags).toEqual(['feature', 'auth']);
  });

  it('should create a task with parent task', async () => {
    const parent = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const child = await ctx.taskStore.createTask(
      createTaskInput(projectId, SIMPLE_PIPELINE.id, { parentTaskId: parent.id }),
    );

    expect(child.parentTaskId).toBe(parent.id);
  });

  it('should filter tasks by parent task id', async () => {
    const parent = await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id, { parentTaskId: parent.id }));
    await ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    const children = await ctx.taskStore.listTasks({ parentTaskId: parent.id });
    expect(children).toHaveLength(1);
    expect(children[0].parentTaskId).toBe(parent.id);
  });
});
