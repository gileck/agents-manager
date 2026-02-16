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

    expect(run.status).toBe('completed');
    expect(run.outcome).toBe('plan_complete');
    expect(run.exitCode).toBe(0);
    expect(run.taskId).toBe(taskId);
    expect(run.agentType).toBe('scripted');
    expect(run.mode).toBe('plan');
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

    expect(run.status).toBe('failed');
    expect(run.exitCode).toBe(1);
    expect(run.outcome).toBe('failed');
  });

  it('should log events for agent start and completion', async () => {
    ctx.scriptedAgent.setScript(happyPlan);

    await ctx.workflowService.startAgent(taskId, 'plan', 'scripted');

    const events = await ctx.taskEventLog.getEvents({ taskId, category: 'agent' });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.message.includes('started'))).toBe(true);
    expect(events.some((e) => e.message.includes('completed'))).toBe(true);
  });

  it('should log activity for agent start and completion', async () => {
    ctx.scriptedAgent.setScript(happyImplement);

    await ctx.workflowService.startAgent(taskId, 'implement', 'scripted');

    const entries = await ctx.activityLog.getEntries({ action: 'agent_start' });
    expect(entries.length).toBeGreaterThanOrEqual(1);

    const completeEntries = await ctx.activityLog.getEntries({ action: 'agent_complete' });
    expect(completeEntries.length).toBeGreaterThanOrEqual(1);
  });
});
