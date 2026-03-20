import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';

describe('Hook Execution', () => {
  let ctx: TestContext;
  let projectId: string;
  let pipelineId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;

    // Create a pipeline with hooks (default policy is best_effort, which is awaited)
    const pipeline = await ctx.pipelineStore.createPipeline({
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
    let hookResolve: () => void;
    const hookCalled = new Promise<void>(r => { hookResolve = r; });
    const hookArgs: { taskId: string; toStatus: string } = { taskId: '', toStatus: '' };

    ctx.pipelineEngine.registerHook('on_start', async (task, transition) => {
      hookArgs.taskId = task.id;
      hookArgs.toStatus = transition.to;
      hookResolve();
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));
    const result = await ctx.pipelineEngine.executeTransition(task, 'in_progress');

    expect(result.success).toBe(true);

    // best_effort hooks are awaited, so they complete before executeTransition returns
    await hookCalled;
    expect(hookArgs.taskId).toBe(task.id);
    expect(hookArgs.toStatus).toBe('in_progress');
  });

  it('should not rollback transition when hook fails', async () => {
    ctx.pipelineEngine.registerHook('on_start', async () => {
      throw new Error('Hook failed!');
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));
    const result = await ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Transition should still succeed (best_effort hooks don't block)
    expect(result.success).toBe(true);
    expect(result.task!.status).toBe('in_progress');

    // Verify the task in DB is also updated
    const dbTask = await ctx.taskStore.getTask(task.id);
    expect(dbTask!.status).toBe('in_progress');
  });

  it('should log hook failure as event', async () => {
    ctx.pipelineEngine.registerHook('on_start', async () => {
      throw new Error('Hook crashed!');
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));
    await ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // best_effort hooks are awaited, so the error is already logged
    const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'system', severity: 'warning' });
    expect(events.length).toBeGreaterThan(0);
    const hookEvent = events.find(e => e.message.includes('on_start'));
    expect(hookEvent).toBeTruthy();
    expect(hookEvent!.message).toContain('threw');
  });

  it('should execute multiple hooks in order', async () => {
    const callOrder: string[] = [];

    ctx.pipelineEngine.registerHook('on_complete', async () => {
      callOrder.push('on_complete');
    });
    ctx.pipelineEngine.registerHook('on_notify', async () => {
      callOrder.push('on_notify');
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));

    // First move to in_progress
    const r1 = await ctx.pipelineEngine.executeTransition(task, 'in_progress');
    expect(r1.success).toBe(true);

    // Then move to done (has on_complete and on_notify hooks)
    const r2 = await ctx.pipelineEngine.executeTransition(r1.task!, 'done');
    expect(r2.success).toBe(true);

    // Both hooks are best_effort (awaited), so they are done
    expect(callOrder).toEqual(['on_complete', 'on_notify']);
  });

  it('should skip unregistered hooks without error', async () => {
    // Don't register any hooks
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));
    const result = await ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Should still succeed
    expect(result.success).toBe(true);
    expect(result.task!.status).toBe('in_progress');
  });
});

describe('Hook Execution Policies', () => {
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

  it('fire_and_forget policy: hook throws but transition still succeeds', async () => {
    let hookResolve: () => void;
    const hookRan = new Promise<void>(r => { hookResolve = r; });

    const pipeline = await ctx.pipelineStore.createPipeline({
      name: 'Fire and Forget Pipeline',
      taskType: 'ff-test',
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
          hooks: [{ name: 'ff_hook', policy: 'fire_and_forget' }],
        },
      ],
    });

    ctx.pipelineEngine.registerHook('ff_hook', async () => {
      hookResolve();
      throw new Error('fire_and_forget hook error');
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipeline.id));
    const result = await ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Transition succeeds immediately (fire_and_forget hooks are not awaited)
    expect(result.success).toBe(true);
    expect(result.task!.status).toBe('in_progress');

    // Hook failures for fire_and_forget are not reported in hookFailures
    expect(result.hookFailures).toBeUndefined();

    // Wait for the async hook to finish and verify the error was logged
    await hookRan;
    // Allow microtask queue to process the .catch() handler
    await new Promise(r => setTimeout(r, 50));

    const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'system', severity: 'error' });
    const ffEvent = events.find(e => e.message.includes('ff_hook') && e.message.includes('fire_and_forget'));
    expect(ffEvent).toBeTruthy();
  });

  it('required policy: hook returns failure populates hookFailures', async () => {
    const pipeline = await ctx.pipelineStore.createPipeline({
      name: 'Required Policy Pipeline',
      taskType: 'required-test',
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
          hooks: [{ name: 'required_hook', policy: 'required' }],
        },
      ],
    });

    ctx.pipelineEngine.registerHook('required_hook', async () => {
      return { success: false, error: 'Required hook rejected' };
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipeline.id));
    const result = await ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Transition fails and status is rolled back when a required hook fails
    expect(result.success).toBe(false);
    expect(result.error).toContain('Required hook rejected');

    // hookFailures should be populated
    expect(result.hookFailures).toBeDefined();
    expect(result.hookFailures!.length).toBe(1);
    expect(result.hookFailures![0].hook).toBe('required_hook');
    expect(result.hookFailures![0].error).toBe('Required hook rejected');
    expect(result.hookFailures![0].policy).toBe('required');

    // Status should be rolled back to original
    const updated = await ctx.taskStore.getTask(task.id);
    expect(updated!.status).toBe('open');

    // Verify the error was logged with 'error' severity for required policy
    const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'system', severity: 'error' });
    const hookEvent = events.find(e => e.message.includes('required_hook'));
    expect(hookEvent).toBeTruthy();
  });

  it('required policy: status is never persisted during hook execution (crash-safe)', async () => {
    let statusDuringHook: string | undefined;

    const pipeline = await ctx.pipelineStore.createPipeline({
      name: 'Crash-Safe Pipeline',
      taskType: 'crash-safe-test',
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
          hooks: [{ name: 'observe_status', policy: 'required' }],
        },
      ],
    });

    ctx.pipelineEngine.registerHook('observe_status', async (task) => {
      // Read the task status from DB during hook execution
      const dbTask = await ctx.taskStore.getTask(task.id);
      statusDuringHook = dbTask!.status;
      return { success: true };
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipeline.id));
    const result = await ctx.pipelineEngine.executeTransition(task, 'in_progress');

    expect(result.success).toBe(true);
    expect(result.task!.status).toBe('in_progress');

    // Key assertion: during required hook execution, the DB status was still 'open'
    // This ensures crash safety — if the process dies during hook execution,
    // the task remains in its original status
    expect(statusDuringHook).toBe('open');

    // After successful transition, DB should now show the new status
    const finalTask = await ctx.taskStore.getTask(task.id);
    expect(finalTask!.status).toBe('in_progress');
  });

  it('required policy: failed hook leaves task in original status (no rollback needed)', async () => {
    const pipeline = await ctx.pipelineStore.createPipeline({
      name: 'No-Rollback Pipeline',
      taskType: 'no-rollback-test',
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
          hooks: [{ name: 'failing_required', policy: 'required' }],
        },
      ],
    });

    ctx.pipelineEngine.registerHook('failing_required', async () => {
      return { success: false, error: 'Hook rejected transition' };
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipeline.id));
    const result = await ctx.pipelineEngine.executeTransition(task, 'in_progress');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Hook rejected transition');

    // Task should still be in original status — never changed, no rollback needed
    const dbTask = await ctx.taskStore.getTask(task.id);
    expect(dbTask!.status).toBe('open');
  });

  it('concurrent transitions on same task are rejected', async () => {
    let hookResolve: () => void;
    const hookBlocked = new Promise<void>(r => { hookResolve = r; });
    let hookStartResolve: () => void;
    const hookStarted = new Promise<void>(r => { hookStartResolve = r; });

    const pipeline = await ctx.pipelineStore.createPipeline({
      name: 'Concurrent Lock Pipeline',
      taskType: 'concurrent-test',
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
          hooks: [{ name: 'slow_hook', policy: 'required' }],
        },
      ],
    });

    ctx.pipelineEngine.registerHook('slow_hook', async () => {
      hookStartResolve();
      await hookBlocked; // Block until test releases
      return { success: true };
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipeline.id));

    // Start first transition (will block on slow_hook)
    const firstTransition = ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Wait for the hook to start
    await hookStarted;

    // Attempt a second transition on the same task — should be rejected
    const secondResult = await ctx.pipelineEngine.executeTransition(task, 'in_progress');
    expect(secondResult.success).toBe(false);
    expect(secondResult.error).toContain('Transition already in progress');

    // Release the first transition
    hookResolve();
    const firstResult = await firstTransition;
    expect(firstResult.success).toBe(true);
    expect(firstResult.task!.status).toBe('in_progress');
  });

  it('force transition is not blocked by in-flight lock', async () => {
    let hookResolve: () => void;
    const hookBlocked = new Promise<void>(r => { hookResolve = r; });
    let hookStartResolve: () => void;
    const hookStarted = new Promise<void>(r => { hookStartResolve = r; });

    const pipeline = await ctx.pipelineStore.createPipeline({
      name: 'Force Lock Pipeline',
      taskType: 'force-lock-test',
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
          hooks: [{ name: 'slow_hook_2', policy: 'required' }],
        },
      ],
    });

    ctx.pipelineEngine.registerHook('slow_hook_2', async () => {
      hookStartResolve();
      await hookBlocked;
      return { success: true };
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipeline.id));

    // Start first transition (will block on slow_hook_2)
    const firstTransition = ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Wait for the hook to start
    await hookStarted;

    // Force transition should NOT be blocked by in-flight lock
    const forceResult = await ctx.pipelineEngine.executeForceTransition(task, 'done');
    expect(forceResult.success).toBe(true);
    expect(forceResult.task!.status).toBe('done');

    // Release the first transition — it will fail because status changed during hooks
    hookResolve();
    const firstResult = await firstTransition;
    // The first transition should fail because TOCTOU check detects status changed
    expect(firstResult.success).toBe(false);
    expect(firstResult.error).toContain('status changed during hook execution');
  });

  it('non-required hooks run after status is committed', async () => {
    let statusDuringBestEffort: string | undefined;

    const pipeline = await ctx.pipelineStore.createPipeline({
      name: 'Post-Commit Hook Pipeline',
      taskType: 'postcommit-test',
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
          hooks: [
            { name: 'required_first', policy: 'required' },
            { name: 'besteffort_second', policy: 'best_effort' },
          ],
        },
      ],
    });

    ctx.pipelineEngine.registerHook('required_first', async () => {
      return { success: true };
    });

    ctx.pipelineEngine.registerHook('besteffort_second', async (task) => {
      const dbTask = await ctx.taskStore.getTask(task.id);
      statusDuringBestEffort = dbTask!.status;
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipeline.id));
    const result = await ctx.pipelineEngine.executeTransition(task, 'in_progress');

    expect(result.success).toBe(true);

    // best_effort hooks run AFTER status is committed
    expect(statusDuringBestEffort).toBe('in_progress');
  });

  it('best_effort policy: hook fails and hookFailures populated with warning severity', async () => {
    const pipeline = await ctx.pipelineStore.createPipeline({
      name: 'Best Effort Pipeline',
      taskType: 'besteffort-test',
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
          hooks: [{ name: 'besteffort_hook', policy: 'best_effort' }],
        },
      ],
    });

    ctx.pipelineEngine.registerHook('besteffort_hook', async () => {
      throw new Error('Best effort hook failed');
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipeline.id));
    const result = await ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Transition still succeeds
    expect(result.success).toBe(true);
    expect(result.task!.status).toBe('in_progress');

    // hookFailures should be populated
    expect(result.hookFailures).toBeDefined();
    expect(result.hookFailures!.length).toBe(1);
    expect(result.hookFailures![0].hook).toBe('besteffort_hook');
    expect(result.hookFailures![0].error).toBe('Best effort hook failed');
    expect(result.hookFailures![0].policy).toBe('best_effort');

    // Verify the error was logged with 'warning' severity for best_effort policy
    const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'system', severity: 'warning' });
    const hookEvent = events.find(e => e.message.includes('besteffort_hook'));
    expect(hookEvent).toBeTruthy();
    expect(hookEvent!.message).toContain('threw');
  });
});
