import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';

describe('Dashboard Stats', () => {
  let ctx: TestContext;

  beforeEach(() => {
    resetCounters();
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should return zero counts for empty database', async () => {
    const stats = await ctx.workflowService.getDashboardStats();

    expect(stats.projectCount).toBe(0);
    expect(stats.totalTasks).toBe(0);
    expect(stats.tasksByStatus).toEqual({});
    expect(stats.activeAgentRuns).toBe(0);
    expect(stats.recentActivityCount).toBe(0);
  });

  it('should count projects correctly', async () => {
    await ctx.projectStore.createProject(createProjectInput());
    await ctx.projectStore.createProject(createProjectInput());
    await ctx.projectStore.createProject(createProjectInput());

    const stats = await ctx.workflowService.getDashboardStats();

    expect(stats.projectCount).toBe(3);
  });

  it('should aggregate tasks by status', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());

    // Create tasks in 'open' status (simple pipeline default)
    await ctx.taskStore.createTask(createTaskInput(project.id, 'pipeline-simple'));
    await ctx.taskStore.createTask(createTaskInput(project.id, 'pipeline-simple'));

    // Transition one to in_progress
    const taskToTransition = await ctx.taskStore.createTask(
      createTaskInput(project.id, 'pipeline-simple'),
    );
    await ctx.pipelineEngine.executeTransition(taskToTransition, 'in_progress', { trigger: 'manual' });

    const stats = await ctx.workflowService.getDashboardStats();

    expect(stats.totalTasks).toBe(3);
    expect(stats.tasksByStatus['open']).toBe(2);
    expect(stats.tasksByStatus['in_progress']).toBe(1);
  });

  it('should count active agent runs', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const task = await ctx.taskStore.createTask(createTaskInput(project.id, 'pipeline-simple'));

    // Create a running agent
    await ctx.agentRunStore.createRun({
      taskId: task.id,
      agentType: 'scripted',
      mode: 'plan',
    });

    const stats = await ctx.workflowService.getDashboardStats();

    expect(stats.activeAgentRuns).toBe(1);
  });

  it('should count recent activity', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());

    // Use workflowService.createTask which logs activity
    await ctx.workflowService.createTask(createTaskInput(project.id, 'pipeline-simple'));
    await ctx.workflowService.createTask(createTaskInput(project.id, 'pipeline-simple'));

    const stats = await ctx.workflowService.getDashboardStats();

    expect(stats.recentActivityCount).toBeGreaterThanOrEqual(2);
  });
});
