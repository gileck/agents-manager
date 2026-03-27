import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';

describe('max_retries guard', () => {
  let ctx: TestContext;
  let taskId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();

    const project = await ctx.projectStore.createProject(createProjectInput());
    // Use agent pipeline — planning→planning (failed) has max_retries guard with max:3
    const task = await ctx.taskStore.createTask(
      createTaskInput(project.id, 'pipeline-agent'),
    );
    taskId = task.id;

    // Move task to 'planning' status first
    await ctx.pipelineEngine.executeTransition(task, 'planning', { trigger: 'manual' });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  // ── Self-loop transitions (planning → planning) ──────────────────
  // planning→planning (failed) is a self-loop, so the guard counts
  // transition_history entries, not failed agent runs.

  it('should allow self-loop transition with no prior self-loop history', async () => {
    const task = await ctx.taskStore.getTask(taskId);
    // planning→planning (failed) auto-transition with max_retries
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    expect(result.success).toBe(true);
  });

  it('should allow self-loop transition within retry limit', async () => {
    // Record 2 prior self-loop transitions (within max=3)
    for (let i = 0; i < 2; i++) {
      ctx.pipelineStore.recordTransitionSync({
        id: randomUUID(),
        taskId,
        fromStatus: 'planning',
        toStatus: 'planning',
        trigger: 'agent',
        actor: null,
        guardResults: {},
        createdAt: Date.now() - (2 - i) * 1000,
      });
    }

    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    expect(result.success).toBe(true);
  });

  it('should block self-loop transition when retries exceeded', async () => {
    // Record 4 prior self-loop transitions (exceeds max=3)
    for (let i = 0; i < 4; i++) {
      ctx.pipelineStore.recordTransitionSync({
        id: randomUUID(),
        taskId,
        fromStatus: 'planning',
        toStatus: 'planning',
        trigger: 'agent',
        actor: null,
        guardResults: {},
        createdAt: Date.now() - (4 - i) * 1000,
      });
    }

    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    expect(result.success).toBe(false);
    expect(result.guardFailures).toBeDefined();
    expect(result.guardFailures!.length).toBeGreaterThan(0);
    expect(result.guardFailures![0].guard).toBe('max_retries');
  });

  it('should respect custom max parameter for self-loop transitions', async () => {
    // The agent pipeline uses max:3, so 3 self-loop transitions should still be allowed (count 3 <= max 3)
    for (let i = 0; i < 3; i++) {
      ctx.pipelineStore.recordTransitionSync({
        id: randomUUID(),
        taskId,
        fromStatus: 'planning',
        toStatus: 'planning',
        trigger: 'agent',
        actor: null,
        guardResults: {},
        createdAt: Date.now() - (3 - i) * 1000,
      });
    }

    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    // 3 self-loop transitions with max=3: count(3) is NOT > max(3), so allowed
    expect(result.success).toBe(true);
  });

  it('should not count non-self-loop transitions towards self-loop limit', async () => {
    // Record transitions for different from→to pairs — these should NOT count
    for (let i = 0; i < 5; i++) {
      ctx.pipelineStore.recordTransitionSync({
        id: randomUUID(),
        taskId,
        fromStatus: 'open',
        toStatus: 'planning',
        trigger: 'manual',
        actor: null,
        guardResults: {},
        createdAt: Date.now() - (5 - i) * 1000,
      });
    }

    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    // No planning→planning records, so self-loop count is 0 → allowed
    expect(result.success).toBe(true);
  });

  // ── Non-self-loop transitions (failed runs) ──────────────────────
  // Non-self-loop transitions with max_retries still count failed agent runs.

  it('should count failures per agent type, not globally', async () => {
    // Create 4 failed runs for OTHER agent types (triager x2, investigator x2)
    // These should NOT count towards the planner's retry budget
    for (const agentType of ['triager', 'triager', 'investigator', 'investigator']) {
      const run = await ctx.agentRunStore.createRun({
        taskId,
        agentType,
        mode: 'new',
      });
      await ctx.agentRunStore.updateRun(run.id, { status: 'failed', output: 'startup error' });
    }

    // For the self-loop guard, failed agent runs don't matter —
    // but with no self-loop transition_history entries, it should pass.
    const task = await ctx.taskStore.getTask(taskId);
    const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    expect(result.success).toBe(true);
  });

  // ── Outcome-driven self-loop retries (the bug fix) ───────────────
  // These test the core bug: conflicts_detected and uncommitted_changes
  // transitions are self-loops where the agent completes successfully but
  // the outcome triggers a retry. The guard must count transition_history.

  it('should block conflicts_detected self-loop after max retries', async () => {
    // Move task to implementing
    const task = await ctx.createTaskAtStatus(
      (await ctx.projectStore.createProject(createProjectInput())).id,
      'pipeline-agent',
      'implementing',
    );

    // Record 4 prior implementing→implementing transitions (exceeds max=3)
    for (let i = 0; i < 4; i++) {
      ctx.pipelineStore.recordTransitionSync({
        id: randomUUID(),
        taskId: task.id,
        fromStatus: 'implementing',
        toStatus: 'implementing',
        trigger: 'agent',
        actor: null,
        guardResults: {},
        createdAt: Date.now() - (4 - i) * 1000,
      });
    }

    const freshTask = await ctx.taskStore.getTask(task.id);
    const result = await ctx.pipelineEngine.executeTransition(freshTask!, 'implementing', {
      trigger: 'agent',
      data: { outcome: 'conflicts_detected' },
    });

    expect(result.success).toBe(false);
    expect(result.guardFailures).toBeDefined();
    expect(result.guardFailures!.some(g => g.guard === 'max_retries')).toBe(true);
  });

  it('should allow conflicts_detected self-loop within retry limit', async () => {
    const task = await ctx.createTaskAtStatus(
      (await ctx.projectStore.createProject(createProjectInput())).id,
      'pipeline-agent',
      'implementing',
    );

    // Record 2 prior implementing→implementing transitions (within max=3)
    for (let i = 0; i < 2; i++) {
      ctx.pipelineStore.recordTransitionSync({
        id: randomUUID(),
        taskId: task.id,
        fromStatus: 'implementing',
        toStatus: 'implementing',
        trigger: 'agent',
        actor: null,
        guardResults: {},
        createdAt: Date.now() - (2 - i) * 1000,
      });
    }

    const freshTask = await ctx.taskStore.getTask(task.id);
    const result = await ctx.pipelineEngine.executeTransition(freshTask!, 'implementing', {
      trigger: 'agent',
      data: { outcome: 'conflicts_detected' },
    });

    expect(result.success).toBe(true);
  });

  it('should block uncommitted_changes self-loop after max:1 retries', async () => {
    const task = await ctx.createTaskAtStatus(
      (await ctx.projectStore.createProject(createProjectInput())).id,
      'pipeline-agent',
      'implementing',
    );

    // uncommitted_changes has max:1, so record 2 prior self-loop transitions
    for (let i = 0; i < 2; i++) {
      ctx.pipelineStore.recordTransitionSync({
        id: randomUUID(),
        taskId: task.id,
        fromStatus: 'implementing',
        toStatus: 'implementing',
        trigger: 'agent',
        actor: null,
        guardResults: {},
        createdAt: Date.now() - (2 - i) * 1000,
      });
    }

    const freshTask = await ctx.taskStore.getTask(task.id);
    const result = await ctx.pipelineEngine.executeTransition(freshTask!, 'implementing', {
      trigger: 'agent',
      data: { outcome: 'uncommitted_changes' },
    });

    expect(result.success).toBe(false);
    expect(result.guardFailures!.some(g => g.guard === 'max_retries')).toBe(true);
  });

  it('should count mixed self-loop outcomes together', async () => {
    // Both conflicts_detected and uncommitted_changes write implementing→implementing
    // transition records. The guard counts ALL self-loop transitions together.
    const task = await ctx.createTaskAtStatus(
      (await ctx.projectStore.createProject(createProjectInput())).id,
      'pipeline-agent',
      'implementing',
    );

    // Record 4 prior implementing→implementing transitions from various outcomes
    for (let i = 0; i < 4; i++) {
      ctx.pipelineStore.recordTransitionSync({
        id: randomUUID(),
        taskId: task.id,
        fromStatus: 'implementing',
        toStatus: 'implementing',
        trigger: i % 2 === 0 ? 'agent' : 'system',
        actor: null,
        guardResults: {},
        createdAt: Date.now() - (4 - i) * 1000,
      });
    }

    const freshTask = await ctx.taskStore.getTask(task.id);

    // conflicts_detected has max:3 → 4 > 3, should be blocked
    const result = await ctx.pipelineEngine.executeTransition(freshTask!, 'implementing', {
      trigger: 'agent',
      data: { outcome: 'conflicts_detected' },
    });

    expect(result.success).toBe(false);
    expect(result.guardFailures!.some(g => g.guard === 'max_retries')).toBe(true);
  });

  it('should block system-triggered self-loop after max retries', async () => {
    const task = await ctx.createTaskAtStatus(
      (await ctx.projectStore.createProject(createProjectInput())).id,
      'pipeline-agent',
      'implementing',
    );

    // Record 4 prior implementing→implementing transitions (exceeds max=3)
    for (let i = 0; i < 4; i++) {
      ctx.pipelineStore.recordTransitionSync({
        id: randomUUID(),
        taskId: task.id,
        fromStatus: 'implementing',
        toStatus: 'implementing',
        trigger: 'system',
        actor: null,
        guardResults: {},
        createdAt: Date.now() - (4 - i) * 1000,
      });
    }

    const freshTask = await ctx.taskStore.getTask(task.id);
    const result = await ctx.pipelineEngine.executeTransition(freshTask!, 'implementing', {
      trigger: 'system',
    });

    expect(result.success).toBe(false);
    expect(result.guardFailures!.some(g => g.guard === 'max_retries')).toBe(true);
  });
});
