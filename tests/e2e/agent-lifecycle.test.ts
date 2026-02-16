import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/main/data/seeded-pipelines';
import { happyPlan, happyImplement } from '../../src/main/agents/scripted-agent';
import type { AgentRunResult } from '../../src/shared/types';

describe('Agent Lifecycle', () => {
  let ctx: TestContext;
  let projectId: string;
  let taskId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
    taskId = task.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should start agent in plan mode and complete with plan_complete outcome', async () => {
    ctx.scriptedAgent.setScript(happyPlan);

    const run = await ctx.workflowService.startAgent(taskId, 'plan', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);
    const completedRun = await ctx.agentRunStore.getRun(run.id);

    expect(completedRun!.status).toBe('completed');
    expect(completedRun!.outcome).toBe('plan_complete');
    expect(completedRun!.exitCode).toBe(0);
    expect(completedRun!.taskId).toBe(taskId);
    expect(completedRun!.agentType).toBe('scripted');
    expect(completedRun!.mode).toBe('plan');
  });

  it('should record agent run in store with cost tokens', async () => {
    ctx.scriptedAgent.setScript(async () => ({
      exitCode: 0,
      output: 'Done',
      outcome: 'plan_complete',
      costInputTokens: 1500,
      costOutputTokens: 500,
    }));

    const run = await ctx.workflowService.startAgent(taskId, 'plan', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);

    const storedRun = await ctx.agentRunStore.getRun(run.id);
    expect(storedRun).not.toBeNull();
    expect(storedRun!.costInputTokens).toBe(1500);
    expect(storedRun!.costOutputTokens).toBe(500);
    expect(storedRun!.completedAt).not.toBeNull();
    expect(storedRun!.startedAt).toBeLessThanOrEqual(storedRun!.completedAt!);
  });

  it('should handle agent failure gracefully', async () => {
    ctx.scriptedAgent.setScript(async (): Promise<AgentRunResult> => ({
      exitCode: 1,
      output: 'Something went wrong',
      outcome: 'failed',
      error: 'Simulated failure',
    }));

    const run = await ctx.workflowService.startAgent(taskId, 'plan', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);
    const completedRun = await ctx.agentRunStore.getRun(run.id);

    expect(completedRun!.status).toBe('failed');
    expect(completedRun!.exitCode).toBe(1);
    expect(completedRun!.outcome).toBe('failed');
  });

  it('should log events for agent start and completion', async () => {
    ctx.scriptedAgent.setScript(happyPlan);

    const run = await ctx.workflowService.startAgent(taskId, 'plan', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);

    const events = await ctx.taskEventLog.getEvents({ taskId, category: 'agent' });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.message.includes('started'))).toBe(true);
    expect(events.some((e) => e.message.includes('completed'))).toBe(true);
  });

  it('should log activity for agent start', async () => {
    ctx.scriptedAgent.setScript(happyImplement);

    const run = await ctx.workflowService.startAgent(taskId, 'implement', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);

    const entries = await ctx.activityLog.getEntries({ action: 'agent_start' });
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });
});
