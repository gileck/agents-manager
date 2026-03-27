import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { PipelineInspectionService } from '../../src/core/services/pipeline-inspection-service';
import type { HookResult } from '../../src/shared/types';

describe('Guard-block diagnostics in PipelineInspectionService', () => {
  let ctx: TestContext;
  let projectId: string;
  let inspectionService: PipelineInspectionService;

  /** Helper: create a task and force it to the given status (bypasses guard/hook issues). */
  async function createTaskAtStatus(status: string) {
    const task = await ctx.taskStore.createTask(
      createTaskInput(projectId, 'pipeline-agent'),
    );
    if (task.status !== status) {
      const result = await ctx.pipelineEngine.executeForceTransition(task, status, { trigger: 'manual' });
      if (!result.success) throw new Error(`Force transition to '${status}' failed: ${result.error}`);
      return result.task!;
    }
    return task;
  }

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();

    // Register stub start_agent hook to avoid background agent spawning
    ctx.pipelineEngine.registerHook('start_agent', async (): Promise<HookResult> => {
      return { success: true };
    });

    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;

    // Create PipelineInspectionService with the test context stores
    inspectionService = new PipelineInspectionService(
      ctx.taskStore,
      ctx.pipelineEngine,
      ctx.pipelineStore,
      ctx.taskEventLog,
      ctx.activityLog,
      ctx.agentRunStore,
    );
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should detect guard-blocked agent transition as stuck in human_review phase', async () => {
    const task = await createTaskAtStatus('pr_review');
    expect(task.status).toBe('pr_review');

    // Simulate the guard block event that the pipeline engine logs
    // when an agent-triggered transition from pr_review → implementing is blocked
    await ctx.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      severity: 'warning',
      message: 'Transition pr_review → implementing blocked by guards: max_retries: Max retries (3) reached — 4 failed runs',
      data: {
        fromStatus: 'pr_review',
        toStatus: 'implementing',
        trigger: 'agent',
        guardFailures: [{ guard: 'max_retries', reason: 'Max retries (3) reached — 4 failed runs' }],
      },
    });

    const diagnostics = await inspectionService.getPipelineDiagnostics(task.id);

    expect(diagnostics).not.toBeNull();
    expect(diagnostics!.isStuck).toBe(true);
    expect(diagnostics!.stuckReason).toContain('Guard blocked');
    expect(diagnostics!.stuckReason).toContain('Max retries');
    expect(diagnostics!.recentGuardBlocks.length).toBeGreaterThan(0);

    const block = diagnostics!.recentGuardBlocks[0];
    expect(block.fromStatus).toBe('pr_review');
    expect(block.toStatus).toBe('implementing');
    expect(block.trigger).toBe('agent');
    expect(block.guardFailures.some((g) => g.guard === 'max_retries')).toBe(true);
  });

  it('should NOT report stuck for human_review phase without guard blocks', async () => {
    const task = await createTaskAtStatus('pr_review');

    const diagnostics = await inspectionService.getPipelineDiagnostics(task.id);

    expect(diagnostics).not.toBeNull();
    expect(diagnostics!.recentGuardBlocks.length).toBe(0);
    expect(diagnostics!.isStuck).toBe(false);
  });

  it('should include guard block records with correct structure', async () => {
    const task = await createTaskAtStatus('plan_review');

    // Log a guard-block event to test parsing
    await ctx.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      severity: 'warning',
      message: 'Transition plan_review → planning blocked by guards: max_retries: Max retries (3) reached — 4 failed runs',
      data: {
        fromStatus: 'plan_review',
        toStatus: 'planning',
        trigger: 'agent',
        guardFailures: [{ guard: 'max_retries', reason: 'Max retries (3) reached — 4 failed runs' }],
      },
    });

    const diagnostics = await inspectionService.getPipelineDiagnostics(task.id);

    expect(diagnostics).not.toBeNull();
    expect(diagnostics!.recentGuardBlocks.length).toBe(1);

    const block = diagnostics!.recentGuardBlocks[0];
    expect(block.taskId).toBe(task.id);
    expect(block.fromStatus).toBe('plan_review');
    expect(block.toStatus).toBe('planning');
    expect(block.trigger).toBe('agent');
    expect(block.guardFailures).toHaveLength(1);
    expect(block.guardFailures[0].guard).toBe('max_retries');
    expect(block.guardFailures[0].reason).toContain('Max retries');
    expect(block.timestamp).toBeGreaterThan(0);
  });

  it('should mark guard-blocked event as stuck only for agent-triggered blocks', async () => {
    const task = await createTaskAtStatus('pr_review');

    // Log a manual-trigger guard block (should NOT make it stuck)
    await ctx.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      severity: 'warning',
      message: 'Transition pr_review → implementing blocked by guards',
      data: {
        fromStatus: 'pr_review',
        toStatus: 'implementing',
        trigger: 'manual',
        guardFailures: [{ guard: 'some_guard', reason: 'Some reason' }],
      },
    });

    const diagnostics = await inspectionService.getPipelineDiagnostics(task.id);

    expect(diagnostics).not.toBeNull();
    // Guard blocks exist but are manual, so task should NOT be stuck
    expect(diagnostics!.recentGuardBlocks.length).toBe(1);
    expect(diagnostics!.isStuck).toBe(false);
  });

  it('should detect real max_retries guard block via pipeline engine', async () => {
    const task = await ctx.taskStore.createTask(
      createTaskInput(projectId, 'pipeline-agent'),
    );

    // Move to planning (manual transition)
    await ctx.pipelineEngine.executeTransition(task, 'planning', { trigger: 'manual' });

    // Record 4 prior self-loop transitions to exceed max_retries (max:3).
    // planning→planning is a self-loop, so the guard counts transition_history
    // entries rather than failed agent runs.
    for (let i = 0; i < 4; i++) {
      ctx.pipelineStore.recordTransitionSync({
        id: require('crypto').randomUUID(),
        taskId: task.id,
        fromStatus: 'planning',
        toStatus: 'planning',
        trigger: 'agent',
        actor: null,
        guardResults: {},
        createdAt: Date.now() - (4 - i) * 1000,
      });
    }

    // Try to trigger the planning → planning (failed) self-loop which has max_retries guard
    const planningTask = await ctx.taskStore.getTask(task.id);
    const result = await ctx.pipelineEngine.executeTransition(planningTask!, 'planning', {
      trigger: 'agent',
      data: { outcome: 'failed' },
    });

    // Should be blocked by max_retries
    expect(result.success).toBe(false);
    expect(result.guardFailures).toBeDefined();
    expect(result.guardFailures![0].guard).toBe('max_retries');

    // Now check diagnostics — guard block event should be recorded
    const diagnostics = await inspectionService.getPipelineDiagnostics(task.id);
    expect(diagnostics).not.toBeNull();
    expect(diagnostics!.recentGuardBlocks.length).toBeGreaterThan(0);
    expect(diagnostics!.recentGuardBlocks.some(
      (gb) => gb.guardFailures.some((g) => g.guard === 'max_retries'),
    )).toBe(true);
  });
});
