import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';
import { happyImplement, happyReview, type ScriptedAgent } from '../../src/core/agents/scripted-agent';
import { registerAgentHandler } from '../../src/core/handlers/agent-handler';

describe('Reviewer Auto-Start After Implementor', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();

    // Configure per-type scripted agents
    const implementorAgent = ctx.agentFramework.getAgent('implementor') as ScriptedAgent;
    implementorAgent.setScript(happyImplement);

    const reviewerAgent = ctx.agentFramework.getAgent('reviewer') as ScriptedAgent;
    reviewerAgent.setScript(happyReview);

    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should auto-start reviewer after implementor completes and reach ready_to_merge', async () => {
    // Create task at implementing status BEFORE registering the agent handler,
    // so the open → implementing transition doesn't fire start_agent.
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

    // Now register the real agent handler so the implementing → pr_review
    // transition's start_agent hook will launch the reviewer.
    registerAgentHandler(ctx.pipelineEngine, {
      workflowService: ctx.workflowService,
      taskEventLog: ctx.taskEventLog,
      agentRunStore: ctx.agentRunStore,
    });

    // Start the implementor agent
    const implRun = await ctx.workflowService.startAgent(task.id, 'new', 'implementor');
    await ctx.agentService.waitForCompletion(implRun.id);

    // The fire_and_forget start_agent hook launches the reviewer asynchronously.
    // Poll for the reviewer run to appear AND reach a terminal status.
    // We can't use waitForCompletion alone because the background promise
    // may not be registered yet during the reviewer's setup phase.
    let reviewerRunId: string | undefined;
    for (let i = 0; i < 100; i++) {
      const runs = await ctx.agentRunStore.getRunsForTask(task.id);
      const reviewerRun = runs.find(r => r.agentType === 'reviewer' && r.id !== implRun.id);
      if (reviewerRun) {
        reviewerRunId = reviewerRun.id;
        if (reviewerRun.status !== 'running') break;
        // Try waitForCompletion in case the background promise is registered now
        await ctx.agentService.waitForCompletion(reviewerRunId);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(reviewerRunId, 'Reviewer run should have been created by the fire_and_forget start_agent hook').toBeDefined();

    // Final wait — the reviewer may still be running if we found it mid-setup
    const reviewerRunCheck = await ctx.agentRunStore.getRun(reviewerRunId!);
    if (reviewerRunCheck?.status === 'running') {
      // Poll until terminal
      for (let i = 0; i < 100; i++) {
        const r = await ctx.agentRunStore.getRun(reviewerRunId!);
        if (r && r.status !== 'running') break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Assert the task reached ready_to_merge (not stuck at pr_review)
    const updatedTask = await ctx.taskStore.getTask(task.id);
    expect(updatedTask!.status, 'Task should reach ready_to_merge, not stay stuck at pr_review').toBe('ready_to_merge');

    // Verify both runs completed successfully
    const implRunFinal = await ctx.agentRunStore.getRun(implRun.id);
    expect(implRunFinal!.status).toBe('completed');
    expect(implRunFinal!.outcome).toBe('pr_ready');

    const reviewerRunFinal = await ctx.agentRunStore.getRun(reviewerRunId!);
    expect(reviewerRunFinal!.status).toBe('completed');
    expect(reviewerRunFinal!.outcome).toBe('approved');
  });
});
