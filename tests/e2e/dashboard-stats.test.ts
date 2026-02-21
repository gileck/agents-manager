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
    await ctx.transitionTo(taskToTransition.id, 'in_progress');

    const stats = await ctx.workflowService.getDashboardStats();

    expect(stats.totalTasks).toBe(3);
    expect(stats.tasksByStatus['open']).toBe(2);
    expect(stats.tasksByStatus['in_progress']).toBe(1);

    // Verify status counts sum to total
    const totalByStatus = Object.values(stats.tasksByStatus as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
    expect(totalByStatus).toBe(stats.totalTasks);
  });

  it('should count active agent runs', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const task1 = await ctx.taskStore.createTask(createTaskInput(project.id, 'pipeline-simple'));
    const task2 = await ctx.taskStore.createTask(createTaskInput(project.id, 'pipeline-simple'));

    // Create two running agents
    await ctx.agentRunStore.createRun({
      taskId: task1.id,
      agentType: 'scripted',
      mode: 'plan',
    });
    await ctx.agentRunStore.createRun({
      taskId: task2.id,
      agentType: 'scripted',
      mode: 'plan',
    });

    const stats = await ctx.workflowService.getDashboardStats();

    expect(stats.activeAgentRuns).toBe(2);
  });

  it('should count recent activity', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());

    // Use workflowService.createTask which logs activity (one entry per task creation)
    await ctx.workflowService.createTask(createTaskInput(project.id, 'pipeline-simple'));
    await ctx.workflowService.createTask(createTaskInput(project.id, 'pipeline-simple'));

    const stats = await ctx.workflowService.getDashboardStats();

    // Exactly 2 task creation activities should have been logged
    expect(stats.recentActivityCount).toBe(2);
  });
});
