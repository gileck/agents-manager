import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/main/data/seeded-pipelines';
import type { AgentRunResult } from '../../src/shared/types';

describe('Error Scenarios', () => {
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

  it('should set run status to failed and phase status to failed on agent failure', async () => {
    ctx.scriptedAgent.setScript(async (): Promise<AgentRunResult> => ({
      exitCode: 1,
      output: 'Error occurred',
      outcome: 'failed',
      error: 'Test failure',
    }));

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'agent' });

    const run = await ctx.agentService.execute(taskId, 'plan', 'scripted');

    expect(run.status).toBe('failed');

    const phases = await ctx.taskPhaseStore.getPhasesForTask(taskId);
    expect(phases[0].status).toBe('failed');
  });

  it('should unlock worktree after failure', async () => {
    ctx.scriptedAgent.setScript(async (): Promise<AgentRunResult> => ({
      exitCode: 1,
      output: 'Crash',
      outcome: 'failed',
    }));

    await ctx.agentService.execute(taskId, 'plan', 'scripted');

    const worktree = await ctx.worktreeManager.get(taskId);
    expect(worktree).not.toBeNull();
    expect(worktree!.locked).toBe(false);
  });

  it('should throw when starting agent for non-existent task', async () => {
    await expect(
      ctx.agentService.execute('nonexistent-task-id', 'plan', 'scripted'),
    ).rejects.toThrow('Task not found');
  });

  it('should return null when answering non-existent prompt', async () => {
    const result = await ctx.workflowService.respondToPrompt('nonexistent-prompt', { answer: 'test' });
    expect(result).toBeNull();
  });

  it('should log error events for failed runs', async () => {
    ctx.scriptedAgent.setScript(async (): Promise<AgentRunResult> => ({
      exitCode: 1,
      output: 'Failure detail',
      outcome: 'failed',
      error: 'Something broke',
    }));

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'agent' });

    await ctx.agentService.execute(taskId, 'plan', 'scripted');

    const events = await ctx.taskEventLog.getEvents({ taskId, category: 'agent', severity: 'error' });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle agent exception without crashing', async () => {
    ctx.scriptedAgent.setScript(async () => {
      throw new Error('Agent crashed unexpectedly');
    });

    const task = await ctx.taskStore.getTask(taskId);
    await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'agent' });

    const run = await ctx.agentService.execute(taskId, 'plan', 'scripted');

    expect(run.status).toBe('failed');
    expect(run.output).toContain('Agent crashed unexpectedly');

    // Worktree should be unlocked after crash
    const worktree = await ctx.worktreeManager.get(taskId);
    expect(worktree!.locked).toBe(false);
  });
});
