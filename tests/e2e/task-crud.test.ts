import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { SIMPLE_PIPELINE } from '../../src/main/data/seeded-pipelines';

describe('Task CRUD', () => {
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

  it('should create a task with default status from pipeline', () => {
    const input = createTaskInput(projectId, SIMPLE_PIPELINE.id);
    const task = ctx.taskStore.createTask(input);

    expect(task.id).toBeDefined();
    expect(task.title).toBe(input.title);
    expect(task.status).toBe('open'); // First status of Simple pipeline
    expect(task.projectId).toBe(projectId);
    expect(task.pipelineId).toBe(SIMPLE_PIPELINE.id);
    expect(task.priority).toBe(0);
    expect(task.tags).toEqual([]);
    expect(task.createdAt).toBeGreaterThan(0);
  });

  it('should create a task with explicit status', () => {
    const input = createTaskInput(projectId, SIMPLE_PIPELINE.id, { status: 'in_progress' });
    const task = ctx.taskStore.createTask(input);

    expect(task.status).toBe('in_progress');
  });

  it('should get a task by id', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const fetched = ctx.taskStore.getTask(task.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(task.id);
    expect(fetched!.title).toBe(task.title);
  });

  it('should return null for non-existent task', () => {
    const result = ctx.taskStore.getTask('non-existent-id');
    expect(result).toBeNull();
  });

  it('should list tasks with no filter', () => {
    ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    const tasks = ctx.taskStore.listTasks();
    expect(tasks).toHaveLength(2);
  });

  it('should list tasks filtered by projectId', () => {
    const project2 = ctx.projectStore.createProject(createProjectInput());
    ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    ctx.taskStore.createTask(createTaskInput(project2.id, SIMPLE_PIPELINE.id));

    const tasks = ctx.taskStore.listTasks({ projectId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].projectId).toBe(projectId);
  });

  it('should list tasks filtered by status', () => {
    ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id, { status: 'in_progress' }));

    const tasks = ctx.taskStore.listTasks({ status: 'open' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('open');
  });

  it('should list tasks filtered by tag', () => {
    ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id, { tags: ['frontend', 'urgent'] }));
    ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id, { tags: ['backend'] }));

    const tasks = ctx.taskStore.listTasks({ tag: 'frontend' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].tags).toContain('frontend');
  });

  it('should update a task', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const updated = ctx.taskStore.updateTask(task.id, {
      title: 'Updated Title',
      priority: 5,
      tags: ['updated'],
    });

    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('Updated Title');
    expect(updated!.priority).toBe(5);
    expect(updated!.tags).toEqual(['updated']);
  });

  it('should return null when updating non-existent task', () => {
    const result = ctx.taskStore.updateTask('non-existent-id', { title: 'test' });
    expect(result).toBeNull();
  });

  it('should delete a task', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const deleted = ctx.taskStore.deleteTask(task.id);

    expect(deleted).toBe(true);
    expect(ctx.taskStore.getTask(task.id)).toBeNull();
  });

  it('should create a task with tags', () => {
    const input = createTaskInput(projectId, SIMPLE_PIPELINE.id, { tags: ['feature', 'auth'] });
    const task = ctx.taskStore.createTask(input);

    expect(task.tags).toEqual(['feature', 'auth']);
  });

  it('should create a task with parent task', () => {
    const parent = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    const child = ctx.taskStore.createTask(
      createTaskInput(projectId, SIMPLE_PIPELINE.id, { parentTaskId: parent.id }),
    );

    expect(child.parentTaskId).toBe(parent.id);
  });

  it('should filter tasks by parent task id', () => {
    const parent = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id, { parentTaskId: parent.id }));
    ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    const children = ctx.taskStore.listTasks({ parentTaskId: parent.id });
    expect(children).toHaveLength(1);
    expect(children[0].parentTaskId).toBe(parent.id);
  });
});
