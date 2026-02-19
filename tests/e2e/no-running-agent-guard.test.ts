import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';

describe('no_running_agent guard', () => {
  let ctx: TestContext;
  let taskId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();

    const project = await ctx.projectStore.createProject(createProjectInput());
    // Use the agent pipeline which has no_running_agent guards
    const task = await ctx.taskStore.createTask(
      createTaskInput(project.id, 'pipeline-agent'),
    );
    taskId = task.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should allow transition when no agent is running', async () => {
    await ctx.transitionTo(taskId, 'planning');
    const task = await ctx.taskStore.getTask(taskId);
    expect(task!.status).toBe('planning');
  });

  it('should block transition when agent is running', async () => {
    // Create a running agent run
    await ctx.agentRunStore.createRun({
      taskId,
      agentType: 'claude-code',
      mode: 'plan',
    });

    await expect(ctx.transitionTo(taskId, 'planning')).rejects.toThrow('no_running_agent');
  });

  it('should allow transition after agent completes', async () => {
    const run = await ctx.agentRunStore.createRun({
      taskId,
      agentType: 'claude-code',
      mode: 'plan',
    });

    // Complete the run
    await ctx.agentRunStore.updateRun(run.id, {
      status: 'completed',
      output: 'done',
      outcome: 'plan_complete',
    });

    await ctx.transitionTo(taskId, 'planning');
    const task = await ctx.taskStore.getTask(taskId);
    expect(task!.status).toBe('planning');
  });

  it('should allow transition after agent fails', async () => {
    const run = await ctx.agentRunStore.createRun({
      taskId,
      agentType: 'claude-code',
      mode: 'plan',
    });

    // Fail the run
    await ctx.agentRunStore.updateRun(run.id, {
      status: 'failed',
      output: 'error',
    });

    await ctx.transitionTo(taskId, 'planning');
    const task = await ctx.taskStore.getTask(taskId);
    expect(task!.status).toBe('planning');
  });
});
