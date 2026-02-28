import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/main/data/seeded-pipelines';
import { happyImplement } from '../../src/main/agents/scripted-agent';
import type { HookResult } from '../../src/shared/types';

describe('Spawn Lock Release Before Transition', () => {
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

  it('should release spawn lock before resolveAndTransition so start_agent hooks can call execute()', async () => {
    // Register a start_agent hook that attempts to call agentService.execute()
    // for a follow-up agent. Before the fix, this would throw
    // "Agent already spawning for task ... — duplicate launch prevented"
    // because the spawn lock was still held during the transition.
    let hookExecuteError: Error | null = null;
    let hookCalled = false;

    ctx.pipelineEngine.registerHook('start_agent', async (task, _transition, _context, _params): Promise<HookResult> => {
      hookCalled = true;
      try {
        // Verify the spawn lock is NOT held at this point
        const isSpawning = ctx.agentService.isSpawning(task.id);
        if (isSpawning) {
          hookExecuteError = new Error('Spawn lock still held during start_agent hook — follow-up agent would be blocked');
        }
      } catch (err) {
        hookExecuteError = err instanceof Error ? err : new Error(String(err));
      }
      return { success: true };
    });

    ctx.scriptedAgent.setScript(happyImplement);

    // Move task to implementing status
    await ctx.transitionTo(taskId, 'implementing');

    // Execute the agent — on completion with pr_ready outcome, the pipeline
    // will transition implementing → pr_review which has a start_agent hook
    const run = await ctx.agentService.execute(taskId, 'implement', 'scripted');
    await ctx.agentService.waitForCompletion(run.id);

    // Verify the hook was called and the spawn lock was released
    expect(hookCalled).toBe(true);
    expect(hookExecuteError).toBeNull();

    // Verify the task transitioned successfully
    const updatedTask = await ctx.taskStore.getTask(taskId);
    expect(updatedTask!.status).toBe('pr_review');

    // Verify the debug log for early spawn lock release was recorded
    const events = await ctx.taskEventLog.getEvents({ taskId, category: 'agent_debug' });
    expect(events.some((e) => e.message.includes('Spawn lock released before outcome transition'))).toBe(true);
  });
});
