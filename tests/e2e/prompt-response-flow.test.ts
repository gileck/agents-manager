import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/main/data/seeded-pipelines';
import { humanInTheLoop } from '../../src/main/agents/scripted-agent';

describe('Prompt Response Flow', () => {
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

  it('should create PendingPrompt with questions when agent returns needs_info', async () => {
    ctx.scriptedAgent.setScript(humanInTheLoop);

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'agent' });

    await ctx.agentService.execute(taskId, 'plan', 'scripted');

    const prompts = await ctx.pendingPromptStore.getPendingForTask(taskId);
    expect(prompts.length).toBe(1);
    expect(prompts[0].promptType).toBe('needs_info');
    expect(prompts[0].payload.questions).toBeTruthy();
    expect(prompts[0].status).toBe('pending');
  });

  it('should transition task to needs_info status', async () => {
    ctx.scriptedAgent.setScript(humanInTheLoop);

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'agent' });

    await ctx.agentService.execute(taskId, 'plan', 'scripted');

    const updatedTask = await ctx.taskStore.getTask(taskId);
    expect(updatedTask!.status).toBe('needs_info');
  });

  it('should answer prompt and log activity when responding', async () => {
    ctx.scriptedAgent.setScript(humanInTheLoop);

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'agent' });
    await ctx.agentService.execute(taskId, 'plan', 'scripted');

    const prompts = await ctx.pendingPromptStore.getPendingForTask(taskId);
    const prompt = prompts[0];

    const answered = await ctx.workflowService.respondToPrompt(prompt.id, { answer: 'The expected behavior is X' });

    expect(answered).not.toBeNull();
    expect(answered!.status).toBe('answered');
    expect(answered!.response).toEqual({ answer: 'The expected behavior is X' });

    const activityEntries = await ctx.activityLog.getEntries({ action: 'prompt_response' });
    expect(activityEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('should transition task back after prompt response via info_provided', async () => {
    ctx.scriptedAgent.setScript(humanInTheLoop);

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'agent' });
    await ctx.agentService.execute(taskId, 'plan', 'scripted');

    const prompts = await ctx.pendingPromptStore.getPendingForTask(taskId);
    await ctx.workflowService.respondToPrompt(prompts[0].id, { answer: 'details here' });

    const updatedTask = await ctx.taskStore.getTask(taskId);
    // The pipeline has transitions from needs_info to planning or implementing with agentOutcome: info_provided
    // Since we came from planning, and both transitions exist, the first matching one should fire
    expect(['planning', 'implementing']).toContain(updatedTask!.status);
  });
});
