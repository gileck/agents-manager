import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/main/data/seeded-pipelines';
import { happyPlan, happyImplement } from '../../src/main/agents/scripted-agent';

describe('Pipeline Auto-Transition', () => {
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

  it('should auto-transition planning to plan_review on plan_complete', async () => {
    ctx.scriptedAgent.setScript(happyPlan);

    // First transition to planning (manual trigger per pipeline definition)
    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'manual' });

    const run = await ctx.agentService.execute(taskId, 'plan', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);

    const updatedTask = await ctx.taskStore.getTask(taskId);
    expect(updatedTask!.status).toBe('plan_review');
  });

  it('should auto-transition implementing to pr_review on pr_ready', async () => {
    ctx.scriptedAgent.setScript(happyImplement);

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'implementing', { trigger: 'manual' });

    const run = await ctx.agentService.execute(taskId, 'implement', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);

    const updatedTask = await ctx.taskStore.getTask(taskId);
    expect(updatedTask!.status).toBe('pr_review');
  });

  it('should stay in current status when no matching agentOutcome transition exists', async () => {
    ctx.scriptedAgent.setScript(async () => ({
      exitCode: 0,
      output: 'Unknown outcome',
      outcome: 'unknown_outcome',
    }));

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'manual' });

    const run = await ctx.agentService.execute(taskId, 'plan', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);

    const updatedTask = await ctx.taskStore.getTask(taskId);
    expect(updatedTask!.status).toBe('planning');
  });

  it('should record agent trigger in transition history', async () => {
    ctx.scriptedAgent.setScript(happyPlan);

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'manual' });
    const run = await ctx.agentService.execute(taskId, 'plan', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);

    const rows = ctx.db.prepare(
      "SELECT * FROM transition_history WHERE task_id = ? AND trigger = 'agent' ORDER BY created_at ASC",
    ).all(taskId) as Array<{ from_status: string; to_status: string; trigger: string }>;

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const planReviewTransition = rows.find((r) => r.to_status === 'plan_review');
    expect(planReviewTransition).toBeTruthy();
    expect(planReviewTransition!.trigger).toBe('agent');
  });
});
