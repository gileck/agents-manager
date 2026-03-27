import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';

describe('max_retries guard', () => {
  let ctx: TestContext;
  let taskId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();

    const project = await ctx.projectStore.createProject(createProjectInput());
    // Use agent pipeline — planning→planning (failed) has max_retries guard with max:3
    const task = await ctx.taskStore.createTask(
      createTaskInput(project.id, 'pipeline-agent'),
    );
    taskId = task.id;

    // Move task to 'planning' status first
    await ctx.pipelineEngine.executeTransition(task, 'planning', { trigger: 'manual' });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should allow transition with no failed runs', async () => {
    const task = await ctx.taskStore.getTask(taskId);
    // planning→planning (failed) auto-transition with max_retries
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    expect(result.success).toBe(true);
  });

  it('should allow transition within retry limit', async () => {
    // Create 2 failed runs (within max=3)
    for (let i = 0; i < 2; i++) {
      const run = await ctx.agentRunStore.createRun({
        taskId,
        agentType: 'planner',
        mode: 'new',
      });
      await ctx.agentRunStore.updateRun(run.id, { status: 'failed', output: 'error' });
    }

    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    expect(result.success).toBe(true);
  });

  it('should block transition when retries exceeded', async () => {
    // Create 4 failed runs (exceeds max=3)
    for (let i = 0; i < 4; i++) {
      const run = await ctx.agentRunStore.createRun({
        taskId,
        agentType: 'planner',
        mode: 'new',
      });
      await ctx.agentRunStore.updateRun(run.id, { status: 'failed', output: 'error' });
    }

    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    expect(result.success).toBe(false);
    expect(result.guardFailures).toBeDefined();
    expect(result.guardFailures!.length).toBeGreaterThan(0);
    expect(result.guardFailures![0].guard).toBe('max_retries');
  });

  it('should respect custom max parameter from pipeline definition', async () => {
    // The agent pipeline uses max:3, so 3 failed runs should still be allowed (count 3 <= max 3)
    for (let i = 0; i < 3; i++) {
      const run = await ctx.agentRunStore.createRun({
        taskId,
        agentType: 'planner',
        mode: 'new',
      });
      await ctx.agentRunStore.updateRun(run.id, { status: 'failed', output: 'error' });
    }

    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    // 3 failed runs with max=3: count(3) is NOT > max(3), so allowed
    expect(result.success).toBe(true);
  });

  it('should count failures per agent type, not globally', async () => {
    // Create 4 failed runs for OTHER agent types (triager x2, investigator x2)
    // These should NOT count towards the planner's retry budget
    for (const agentType of ['triager', 'triager', 'investigator', 'investigator']) {
      const run = await ctx.agentRunStore.createRun({
        taskId,
        agentType,
        mode: 'new',
      });
      await ctx.agentRunStore.updateRun(run.id, { status: 'failed', output: 'startup error' });
    }

    // Task is at 'planning' status (from beforeEach).
    // planning→planning (failed) auto-retry has max_retries(max:3) guard
    // and start_agent(planner) hook.
    // There are 4 total failed runs, but 0 are for 'planner',
    // so the guard should allow it.
    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    expect(result.success).toBe(true);
  });

  it('should block when per-agent-type retries exceeded', async () => {
    // Create 4 failed runs specifically for 'planner' (exceeds max=3)
    for (let i = 0; i < 4; i++) {
      const run = await ctx.agentRunStore.createRun({
        taskId,
        agentType: 'planner',
        mode: 'new',
      });
      await ctx.agentRunStore.updateRun(run.id, { status: 'failed', output: 'error' });
    }

    // Also create some failed runs for other agents — should not affect planner count
    for (const agentType of ['triager', 'investigator']) {
      const run = await ctx.agentRunStore.createRun({
        taskId,
        agentType,
        mode: 'new',
      });
      await ctx.agentRunStore.updateRun(run.id, { status: 'failed', output: 'error' });
    }

    const task = await ctx.taskStore.getTask(taskId);
    // planning→planning (failed) auto-retry has start_agent(planner) hook
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    // 4 planner failures > max(3), so should be blocked
    expect(result.success).toBe(false);
    expect(result.guardFailures).toBeDefined();
    expect(result.guardFailures!.some(g => g.guard === 'max_retries')).toBe(true);
  });
});
