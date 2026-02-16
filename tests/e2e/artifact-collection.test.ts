import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/main/data/seeded-pipelines';
import { happyPlan, happyImplement } from '../../src/main/agents/scripted-agent';

describe('Artifact Collection', () => {
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

  it('should create branch artifact after agent run', async () => {
    ctx.scriptedAgent.setScript(happyPlan);

    await ctx.workflowService.startAgent(taskId, 'plan', 'scripted');

    const artifacts = await ctx.taskArtifactStore.getArtifactsForTask(taskId, 'branch');
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].type).toBe('branch');
    expect(artifacts[0].data.branch).toBeTruthy();
  });

  it('should create PR artifact when outcome is pr_ready', async () => {
    ctx.scriptedAgent.setScript(happyImplement);

    // First transition to implementing
    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'implementing', { trigger: 'agent' });

    await ctx.agentService.execute(taskId, 'implement', 'scripted');

    const prArtifacts = await ctx.taskArtifactStore.getArtifactsForTask(taskId, 'pr');
    expect(prArtifacts.length).toBe(1);
    expect(prArtifacts[0].data.url).toBeTruthy();
    expect(prArtifacts[0].data.number).toBeTruthy();
  });

  it('should create diff artifact when outcome is pr_ready', async () => {
    ctx.scriptedAgent.setScript(happyImplement);

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'implementing', { trigger: 'agent' });

    await ctx.agentService.execute(taskId, 'implement', 'scripted');

    const diffArtifacts = await ctx.taskArtifactStore.getArtifactsForTask(taskId, 'diff');
    expect(diffArtifacts.length).toBe(1);
    expect(diffArtifacts[0].data.diff).toBeTruthy();
  });

  it('should update task prLink and branchName after PR creation', async () => {
    ctx.scriptedAgent.setScript(happyImplement);

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'implementing', { trigger: 'agent' });

    await ctx.agentService.execute(taskId, 'implement', 'scripted');

    const updatedTask = await ctx.taskStore.getTask(taskId);
    expect(updatedTask!.prLink).toBeTruthy();
    expect(updatedTask!.branchName).toBeTruthy();
  });
});
