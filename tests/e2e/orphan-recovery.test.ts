import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/main/data/seeded-pipelines';
import { now } from '../../src/main/stores/utils';

describe('Orphan Recovery (recoverOrphanedRuns)', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should mark orphaned running runs as failed', async () => {
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

    // Insert a "running" agent run directly (simulates app crash mid-run)
    const run = await ctx.agentRunStore.createRun({
      taskId: task.id,
      agentType: 'scripted',
      mode: 'new',
    });

    const recovered = await ctx.agentService.recoverOrphanedRuns();

    expect(recovered.length).toBe(1);
    expect(recovered[0].id).toBe(run.id);
    expect(recovered[0].status).toBe('failed');
    expect(recovered[0].outcome).toBe('interrupted');

    const storedRun = await ctx.agentRunStore.getRun(run.id);
    expect(storedRun!.status).toBe('failed');
    expect(storedRun!.outcome).toBe('interrupted');
    expect(storedRun!.completedAt).not.toBeNull();
  });

  it('should fail the active phase for orphaned runs', async () => {
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

    await ctx.agentRunStore.createRun({
      taskId: task.id,
      agentType: 'scripted',
      mode: 'new',
    });

    // Create an active phase
    const phase = await ctx.taskPhaseStore.createPhase({
      taskId: task.id,
      phase: 'Phase 1',
    });
    await ctx.taskPhaseStore.updatePhase(phase.id, { status: 'active', startedAt: now() });

    await ctx.agentService.recoverOrphanedRuns();

    const updatedPhase = (await ctx.taskPhaseStore.getPhasesForTask(task.id))[0];
    expect(updatedPhase.status).toBe('failed');
    expect(updatedPhase.completedAt).not.toBeNull();
  });

  it('should unlock worktree for orphaned runs', async () => {
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

    await ctx.agentRunStore.createRun({
      taskId: task.id,
      agentType: 'scripted',
      mode: 'new',
    });

    // Simulate a locked worktree
    await ctx.worktreeManager.create('task/test-branch', task.id);
    await ctx.worktreeManager.lock(task.id);

    const wtBefore = await ctx.worktreeManager.get(task.id);
    expect(wtBefore!.locked).toBe(true);

    await ctx.agentService.recoverOrphanedRuns();

    const wtAfter = await ctx.worktreeManager.get(task.id);
    expect(wtAfter!.locked).toBe(false);
  });

  it('should log recovery event', async () => {
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

    await ctx.agentRunStore.createRun({
      taskId: task.id,
      agentType: 'scripted',
      mode: 'new',
    });

    await ctx.agentService.recoverOrphanedRuns();

    const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'agent' });
    expect(events.some((e) => e.message.includes('interrupted by app shutdown'))).toBe(true);
  });

  it('should return empty array when no orphaned runs exist', async () => {
    const recovered = await ctx.agentService.recoverOrphanedRuns();
    expect(recovered).toEqual([]);
  });
});
