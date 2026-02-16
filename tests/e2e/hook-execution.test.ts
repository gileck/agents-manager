import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';

describe('Hook Execution', () => {
  let ctx: TestContext;
  let projectId: string;
  let pipelineId: string;

  beforeEach(() => {
    resetCounters();
    ctx = createTestContext();
    const project = ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;

    // Create a pipeline with hooks
    const pipeline = ctx.pipelineStore.createPipeline({
      name: 'Hook Test Pipeline',
      taskType: 'hook-test',
      statuses: [
        { name: 'open', label: 'Open' },
        { name: 'in_progress', label: 'In Progress' },
        { name: 'done', label: 'Done', isFinal: true },
      ],
      transitions: [
        {
          from: 'open',
          to: 'in_progress',
          trigger: 'manual',
          hooks: [{ name: 'on_start' }],
        },
        {
          from: 'in_progress',
          to: 'done',
          trigger: 'manual',
          hooks: [{ name: 'on_complete' }, { name: 'on_notify' }],
        },
      ],
    });
    pipelineId = pipeline.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should call hook on transition', async () => {
    const hookCalled = vi.fn();
    ctx.pipelineEngine.registerHook('on_start', async (task, transition, context) => {
      hookCalled(task.id, transition.to);
    });

    const task = ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));
    const result = ctx.pipelineEngine.executeTransition(task, 'in_progress');

    expect(result.success).toBe(true);

    // Hooks are async, wait for them
    await vi.waitFor(() => {
      expect(hookCalled).toHaveBeenCalledWith(task.id, 'in_progress');
    });
  });

  it('should not rollback transition when hook fails', async () => {
    ctx.pipelineEngine.registerHook('on_start', async () => {
      throw new Error('Hook failed!');
    });

    const task = ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));
    const result = ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Transition should still succeed
    expect(result.success).toBe(true);
    expect(result.task!.status).toBe('in_progress');

    // Verify the task in DB is also updated
    const dbTask = ctx.taskStore.getTask(task.id);
    expect(dbTask!.status).toBe('in_progress');
  });

  it('should log hook failure as event', async () => {
    ctx.pipelineEngine.registerHook('on_start', async () => {
      throw new Error('Hook crashed!');
    });

    const task = ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));
    ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Wait for the async hook to fail and be logged
    await vi.waitFor(() => {
      const events = ctx.taskEventLog.getEvents({ taskId: task.id, category: 'system', severity: 'error' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].message).toContain('on_start');
      expect(events[0].message).toContain('failed');
    });
  });

  it('should execute multiple hooks in order', async () => {
    const callOrder: string[] = [];

    ctx.pipelineEngine.registerHook('on_complete', async () => {
      callOrder.push('on_complete');
    });
    ctx.pipelineEngine.registerHook('on_notify', async () => {
      callOrder.push('on_notify');
    });

    const task = ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));

    // First move to in_progress
    const r1 = ctx.pipelineEngine.executeTransition(task, 'in_progress');
    expect(r1.success).toBe(true);

    // Then move to done (has on_complete and on_notify hooks)
    const r2 = ctx.pipelineEngine.executeTransition(r1.task!, 'done');
    expect(r2.success).toBe(true);

    await vi.waitFor(() => {
      expect(callOrder).toEqual(['on_complete', 'on_notify']);
    });
  });

  it('should skip unregistered hooks without error', () => {
    // Don't register any hooks
    const task = ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));
    const result = ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Should still succeed
    expect(result.success).toBe(true);
    expect(result.task!.status).toBe('in_progress');
  });
});
