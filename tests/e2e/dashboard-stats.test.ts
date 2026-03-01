import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';
import type { HookResult } from '../../src/shared/types';

describe('Dashboard Stats', () => {
  let ctx: TestContext;

  beforeEach(() => {
    resetCounters();
    ctx = createTestContext();

    // Register stub start_agent hook so fire_and_forget hooks don't interfere
    ctx.pipelineEngine.registerHook('start_agent', async (): Promise<HookResult> => {
      return { success: true };
    });
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

    // Create tasks in 'open' status (agent pipeline default)
    await ctx.taskStore.createTask(createTaskInput(project.id, AGENT_PIPELINE.id));
    await ctx.taskStore.createTask(createTaskInput(project.id, AGENT_PIPELINE.id));

    // Transition one to designing
    const taskToTransition = await ctx.taskStore.createTask(
      createTaskInput(project.id, AGENT_PIPELINE.id),
    );
    await ctx.transitionTo(taskToTransition.id, 'designing');

    const stats = await ctx.workflowService.getDashboardStats();

    expect(stats.totalTasks).toBe(3);
    expect(stats.tasksByStatus['open']).toBe(2);
    expect(stats.tasksByStatus['designing']).toBe(1);

    // Verify status counts sum to total
    const totalByStatus = Object.values(stats.tasksByStatus as Record<string, number>).reduce((a: number, b: number) => a + b, 0);
    expect(totalByStatus).toBe(stats.totalTasks);
  });

  it('should count active agent runs', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());
    const task1 = await ctx.taskStore.createTask(createTaskInput(project.id, AGENT_PIPELINE.id));
    const task2 = await ctx.taskStore.createTask(createTaskInput(project.id, AGENT_PIPELINE.id));

    // Create two running agents
    await ctx.agentRunStore.createRun({
      taskId: task1.id,
      agentType: 'scripted',
      mode: 'new',
    });
    await ctx.agentRunStore.createRun({
      taskId: task2.id,
      agentType: 'scripted',
      mode: 'new',
    });

    const stats = await ctx.workflowService.getDashboardStats();

    expect(stats.activeAgentRuns).toBe(2);
  });

  it('should count recent activity', async () => {
    const project = await ctx.projectStore.createProject(createProjectInput());

    // Use workflowService.createTask which logs activity (one entry per task creation)
    await ctx.workflowService.createTask(createTaskInput(project.id, AGENT_PIPELINE.id));
    await ctx.workflowService.createTask(createTaskInput(project.id, AGENT_PIPELINE.id));

    const stats = await ctx.workflowService.getDashboardStats();

    // Exactly 2 task creation activities should have been logged
    expect(stats.recentActivityCount).toBe(2);
  });
});
