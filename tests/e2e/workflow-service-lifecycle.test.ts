import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';

describe('Workflow Service Lifecycle', () => {
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

  it('should log activity on createTask', async () => {
    const task = await ctx.workflowService.createTask(
      createTaskInput(projectId, 'pipeline-simple'),
    );

    const entries = await ctx.activityLog.getEntries({
      entityType: 'task',
      entityId: task.id,
    });

    expect(entries.length).toBeGreaterThanOrEqual(1);
    const createEntry = entries.find(e => e.action === 'create');
    expect(createEntry).toBeDefined();
    expect(createEntry!.summary).toContain(task.title);
  });

  it('should log activity on updateTask', async () => {
    const task = await ctx.workflowService.createTask(
      createTaskInput(projectId, 'pipeline-simple'),
    );

    await ctx.workflowService.updateTask(task.id, { title: 'Updated Title' });

    const entries = await ctx.activityLog.getEntries({
      entityType: 'task',
      entityId: task.id,
    });

    const updateEntry = entries.find(e => e.action === 'update');
    expect(updateEntry).toBeDefined();
    expect(updateEntry!.summary).toContain('Updated Title');
  });

  it('should log activity on deleteTask', async () => {
    const task = await ctx.workflowService.createTask(
      createTaskInput(projectId, 'pipeline-simple'),
    );
    const id = task.id;

    const deleted = await ctx.workflowService.deleteTask(id);
    expect(deleted).toBe(true);

    const entries = await ctx.activityLog.getEntries({
      entityType: 'task',
      entityId: id,
    });

    const deleteEntry = entries.find(e => e.action === 'delete');
    expect(deleteEntry).toBeDefined();
  });

  it('should clean up worktree on deleteTask', async () => {
    const task = await ctx.workflowService.createTask(
      createTaskInput(projectId, 'pipeline-simple'),
    );

    // Simulate a worktree existing for this task
    const wm = ctx.worktreeManager;
    await wm.create('task-branch', task.id);
    const beforeDelete = await wm.get(task.id);
    expect(beforeDelete).not.toBeNull();

    await ctx.workflowService.deleteTask(task.id);

    const afterDelete = await wm.get(task.id);
    expect(afterDelete).toBeNull();
  });

  it('should reset task to initial status', async () => {
    const task = await ctx.workflowService.createTask(
      createTaskInput(projectId, 'pipeline-simple'),
    );

    // Transition to in_progress
    await ctx.transitionTo(task.id, 'in_progress');
    const inProgress = await ctx.taskStore.getTask(task.id);
    expect(inProgress!.status).toBe('in_progress');

    // Reset
    const reset = await ctx.workflowService.resetTask(task.id);
    expect(reset).not.toBeNull();
    expect(reset!.status).toBe('open');
  });

  it('should clean worktree on resetTask', async () => {
    const task = await ctx.workflowService.createTask(
      createTaskInput(projectId, 'pipeline-simple'),
    );

    const wm = ctx.worktreeManager;
    await wm.create('task-branch', task.id);
    expect(await wm.get(task.id)).not.toBeNull();

    await ctx.workflowService.resetTask(task.id);

    expect(await wm.get(task.id)).toBeNull();
  });

  it('should log transition with actor', async () => {
    const task = await ctx.workflowService.createTask(
      createTaskInput(projectId, 'pipeline-simple'),
    );

    await ctx.workflowService.transitionTask(task.id, 'in_progress', 'alice');

    const entries = await ctx.activityLog.getEntries({
      entityType: 'task',
      entityId: task.id,
    });

    const transitionEntry = entries.find(e => e.action === 'transition');
    expect(transitionEntry).toBeDefined();
    expect(transitionEntry!.data).toHaveProperty('actor', 'alice');
    expect(transitionEntry!.data).toHaveProperty('fromStatus', 'open');
    expect(transitionEntry!.data).toHaveProperty('toStatus', 'in_progress');
  });

  it('should clean worktree on transition to final status', async () => {
    const task = await ctx.workflowService.createTask(
      createTaskInput(projectId, 'pipeline-simple'),
    );

    const wm = ctx.worktreeManager;
    await wm.create('task-branch', task.id);

    // Transition to in_progress, then done (final)
    await ctx.workflowService.transitionTask(task.id, 'in_progress');
    await ctx.workflowService.transitionTask(task.id, 'done');

    const worktree = await wm.get(task.id);
    expect(worktree).toBeNull();
  });
});
