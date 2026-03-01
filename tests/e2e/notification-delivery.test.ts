import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';
import type { HookResult } from '../../src/shared/types';

describe('Notification Delivery', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();

    // Register stub start_agent hook (fire-and-forget hooks need a handler)
    ctx.pipelineEngine.registerHook('start_agent', async (): Promise<HookResult> => {
      return { success: true };
    });

    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should send notification on plan_complete agent transition', async () => {
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'planning');
    ctx.notificationRouter.clear();

    // Trigger agent outcome transition: planning → plan_review (has notify hook)
    await ctx.pipelineEngine.executeTransition(task, 'plan_review', {
      trigger: 'agent',
      agentOutcome: 'plan_complete',
    });

    expect(ctx.notificationRouter.sent.length).toBeGreaterThanOrEqual(1);
    const notification = ctx.notificationRouter.sent[0].notification;
    expect(notification.taskId).toBe(task.id);
  });

  it('should send notification on design_ready agent transition', async () => {
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'designing');
    ctx.notificationRouter.clear();

    await ctx.pipelineEngine.executeTransition(task, 'design_review', {
      trigger: 'agent',
      agentOutcome: 'design_ready',
    });

    expect(ctx.notificationRouter.sent.length).toBeGreaterThanOrEqual(1);
    expect(ctx.notificationRouter.sent[0].notification.taskId).toBe(task.id);
  });

  it('should send notification on needs_info agent transition', async () => {
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'planning');
    ctx.notificationRouter.clear();

    await ctx.pipelineEngine.executeTransition(task, 'needs_info', {
      trigger: 'agent',
      agentOutcome: 'needs_info',
    });

    expect(ctx.notificationRouter.sent.length).toBeGreaterThanOrEqual(1);
    expect(ctx.notificationRouter.sent[0].notification.taskId).toBe(task.id);
  });
});
