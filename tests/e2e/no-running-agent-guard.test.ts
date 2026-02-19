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
    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'manual',
    });

    expect(result.success).toBe(true);
  });

  it('should block transition when agent is running', async () => {
    // Create a running agent run
    await ctx.agentRunStore.createRun({
      taskId,
      agentType: 'claude-code',
      mode: 'plan',
    });

    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'manual',
    });

    expect(result.success).toBe(false);
    expect(result.guardFailures).toBeDefined();
    expect(result.guardFailures!.length).toBeGreaterThan(0);
    expect(result.guardFailures![0].guard).toBe('no_running_agent');
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

    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'manual',
    });

    expect(result.success).toBe(true);
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

    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'manual',
    });

    expect(result.success).toBe(true);
  });
});
