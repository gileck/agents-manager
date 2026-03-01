import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';
import { happyPlan, happyImplement } from '../../src/core/agents/scripted-agent';

describe('Multi-Phase Tasks', () => {
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

  it('should track plan phase creation and completion', async () => {
    ctx.scriptedAgent.setScript(happyPlan);

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'agent' });

    const run = await ctx.agentService.execute(taskId, 'new', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);

    const phases = await ctx.taskPhaseStore.getPhasesForTask(taskId);
    expect(phases.length).toBe(1);
    expect(phases[0].phase).toBe('new');
    expect(phases[0].status).toBe('completed');
    expect(phases[0].completedAt).not.toBeNull();
  });

  it('should track implement phase after plan phase', async () => {
    ctx.scriptedAgent.setScript(happyPlan);

    // Run plan phase
    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'agent' });
    const planRun = await ctx.agentService.execute(taskId, 'new', 'scripted');
    await ctx.agentService.waitForCompletion(planRun.id);

    // Manually approve plan → move to implementing
    await ctx.transitionTo(taskId, 'implementing');

    // Run implement phase
    ctx.scriptedAgent.setScript(happyImplement);
    const implRun = await ctx.agentService.execute(taskId, 'new', 'scripted');
    await ctx.agentService.waitForCompletion(implRun.id);

    const phases = await ctx.taskPhaseStore.getPhasesForTask(taskId);
    expect(phases.length).toBe(2);

    // Both phases use mode 'new'; verify by order (chronological)
    expect(phases[0].phase).toBe('new');
    expect(phases[1].phase).toBe('new');
    expect(phases[0].status).toBe('completed');
    expect(phases[1].status).toBe('completed');
  });

  it('should link agent run to phase via agentRunId', async () => {
    ctx.scriptedAgent.setScript(happyPlan);

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'agent' });

    const run = await ctx.agentService.execute(taskId, 'new', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);

    const phases = await ctx.taskPhaseStore.getPhasesForTask(taskId);
    expect(phases[0].agentRunId).toBe(run.id);
  });
});
