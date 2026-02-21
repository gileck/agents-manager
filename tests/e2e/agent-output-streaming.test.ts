import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/main/data/seeded-pipelines';

describe('Agent Output Streaming', () => {
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

  it('should pass onOutput callback through to agent.execute()', async () => {
    const chunks: string[] = [];
    const onOutput = (chunk: string) => chunks.push(chunk);

    ctx.scriptedAgent.setScript(async () => ({
      exitCode: 0,
      output: 'Done',
      outcome: 'plan_complete',
    }));

    // No output chunks set, so onOutput should not receive anything
    const run = await ctx.agentService.execute(taskId, 'plan', 'scripted', onOutput);
    await ctx.agentService.waitForCompletion(run.id);

    expect(chunks).toEqual([]);
  });

  it('should receive output chunks via onOutput when outputChunks are set', async () => {
    const chunks: string[] = [];
    const onOutput = (chunk: string) => chunks.push(chunk);

    ctx.scriptedAgent.setOutputChunks(['chunk1', 'chunk2', 'chunk3']);
    ctx.scriptedAgent.setScript(async () => ({
      exitCode: 0,
      output: 'chunk1chunk2chunk3',
      outcome: 'plan_complete',
    }));

    const run = await ctx.agentService.execute(taskId, 'plan', 'scripted', onOutput);
    await ctx.agentService.waitForCompletion(run.id);

    // Verify onOutput received the chunks from ScriptedAgent
    expect(chunks).toContain('chunk1');
    expect(chunks).toContain('chunk2');
    expect(chunks).toContain('chunk3');
  });

  it('should thread onOutput from workflowService.startAgent() to agentService.execute()', async () => {
    const chunks: string[] = [];
    const onOutput = (chunk: string) => chunks.push(chunk);

    ctx.scriptedAgent.setOutputChunks(['part-a', 'part-b']);
    ctx.scriptedAgent.setScript(async () => ({
      exitCode: 0,
      output: 'part-apart-b',
      outcome: 'plan_complete',
    }));

    const run = await ctx.workflowService.startAgent(taskId, 'plan', 'scripted', onOutput);
    await ctx.agentService.waitForCompletion(run.id);
    const completedRun = await ctx.agentRunStore.getRun(run.id);

    expect(completedRun!.status).toBe('completed');
    expect(completedRun!.outcome).toBe('plan_complete');
    expect(chunks).toContain('part-a');
    expect(chunks).toContain('part-b');
  });

  it('should complete without error when no onOutput is provided', async () => {
    ctx.scriptedAgent.setOutputChunks(['chunk1', 'chunk2']);
    ctx.scriptedAgent.setScript(async () => ({
      exitCode: 0,
      output: 'Done',
      outcome: 'plan_complete',
    }));

    // No onOutput callback provided
    const run = await ctx.agentService.execute(taskId, 'plan', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);
    const completedRun = await ctx.agentRunStore.getRun(run.id);

    expect(completedRun!.status).toBe('completed');
    expect(completedRun!.outcome).toBe('plan_complete');
  });

  it('should verify onOutput function is passed to agent.execute()', async () => {
    const chunks: string[] = [];
    const onOutput = (chunk: string) => chunks.push(chunk);

    ctx.scriptedAgent.setScript(async () => ({
      exitCode: 0,
      output: 'Done',
      outcome: 'plan_complete',
    }));

    const executeSpy = vi.spyOn(ctx.scriptedAgent, 'execute');

    const run = await ctx.agentService.execute(taskId, 'plan', 'scripted', onOutput);
    await ctx.agentService.waitForCompletion(run.id);

    // Verify an onOutput wrapper was passed through to agent.execute()
    expect(executeSpy).toHaveBeenCalledOnce();
    const callArgs = executeSpy.mock.calls[0];
    // AgentService wraps onOutput in a buffering lambda, so check it's a function
    expect(typeof callArgs[2]).toBe('function');
    // Invoke the wrapper to verify it delegates to original callback
    callArgs[2]!('test-chunk');
    expect(chunks).toContain('test-chunk');
  });
});
