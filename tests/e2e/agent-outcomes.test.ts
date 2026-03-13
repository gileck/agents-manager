import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';
import { StubGitOps } from '../../src/core/services/stub-git-ops';
import type { HookResult } from '../../src/shared/types';
import { now } from '../../src/core/stores/utils';

describe('Agent Outcome Transitions', () => {
  let ctx: TestContext;
  let projectId: string;
  let startAgentCalls: Array<{ taskId: string; mode: string }>;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    startAgentCalls = [];

    ctx.pipelineEngine.registerHook('start_agent', async (task, _transition, _context, params): Promise<HookResult> => {
      startAgentCalls.push({
        taskId: task.id,
        mode: params?.mode as string,
      });
      return { success: true };
    });

    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('no_changes outcome', () => {
    it('should transition implementing → open when no diff detected but branch has unique commits', async () => {
      const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

      // Configure empty diff to trigger no_changes
      const stub = ctx.gitOps as StubGitOps;
      stub.diffOverride = '';
      // Branch HEAD differs from origin/main — agent has commits but diff is empty (anomalous)
      stub.revParseMap = new Map([['HEAD', 'aaa111'], ['origin/main', 'bbb222']]);

      // Create a worktree and phase to satisfy OutcomeResolver
      await ctx.worktreeManager.create('task/test-branch', task.id);
      await ctx.worktreeManager.lock(task.id);
      const phase = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 1' });
      await ctx.taskPhaseStore.updatePhase(phase.id, { status: 'active', startedAt: now() });

      // Create an agent run
      const run = await ctx.agentRunStore.createRun({
        taskId: task.id,
        agentType: 'scripted',
        mode: 'new',
      });

      // Call OutcomeResolver directly
      await ctx.outcomeResolver.resolveAndTransition({
        taskId: task.id,
        result: { exitCode: 0, output: 'Done', outcome: 'pr_ready' },
        run: { id: run.id },
        worktree: { branch: 'task/test-branch', path: '/tmp/worktrees/' + task.id },
        worktreeManager: ctx.worktreeManager,
        phase: { id: phase.id },
        context: { workdir: '/tmp', mode: 'new' } as never,
      });

      const updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('open');

      // Verify event log records the no_changes detection
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'agent' });
      expect(events.some((e) => e.message.includes('no changes detected'))).toBe(true);
    });

    it('should transition implementing → done when branch HEAD equals origin/main (already on main)', async () => {
      const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

      // Configure empty diff + same HEAD as origin/main (work already on main)
      const stub = ctx.gitOps as StubGitOps;
      stub.diffOverride = '';
      stub.revParseOverride = 'same-sha';

      await ctx.worktreeManager.create('task/test-branch', task.id);
      await ctx.worktreeManager.lock(task.id);
      const phase = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 1' });
      await ctx.taskPhaseStore.updatePhase(phase.id, { status: 'active', startedAt: now() });

      const run = await ctx.agentRunStore.createRun({
        taskId: task.id,
        agentType: 'scripted',
        mode: 'new',
      });

      await ctx.outcomeResolver.resolveAndTransition({
        taskId: task.id,
        result: { exitCode: 0, output: 'Done', outcome: 'pr_ready' },
        run: { id: run.id },
        worktree: { branch: 'task/test-branch', path: '/tmp/worktrees/' + task.id },
        worktreeManager: ctx.worktreeManager,
        phase: { id: phase.id },
        context: { workdir: '/tmp', mode: 'new' } as never,
      });

      const updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('done');

      // Verify event log records the already_on_main detection
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'agent' });
      expect(events.some((e) => e.message.includes('already on main'))).toBe(true);
    });
  });

  describe('merge-base pre-check', () => {
    it('should skip rebase and return pr_ready when branch is already rebased', async () => {
      const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

      // Configure mergeBase and revParse to return the same hash (branch already rebased)
      const stub = ctx.gitOps as StubGitOps;
      stub.mergeBaseOverride = 'abc123';
      stub.revParseOverride = 'abc123';

      await ctx.worktreeManager.create('task/test-branch', task.id);
      await ctx.worktreeManager.lock(task.id);
      const phase = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 1' });
      await ctx.taskPhaseStore.updatePhase(phase.id, { status: 'active', startedAt: now() });

      const run = await ctx.agentRunStore.createRun({
        taskId: task.id,
        agentType: 'scripted',
        mode: 'new',
      });

      await ctx.outcomeResolver.resolveAndTransition({
        taskId: task.id,
        result: { exitCode: 0, output: 'Done', outcome: 'pr_ready' },
        run: { id: run.id },
        worktree: { branch: 'task/test-branch', path: '/tmp/worktrees/' + task.id },
        worktreeManager: ctx.worktreeManager,
        phase: { id: phase.id },
        context: { workdir: '/tmp', mode: 'new' } as never,
      });

      const updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('pr_review');

      // Verify event log records the skip
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'git' });
      expect(events.some((e) => e.message.includes('already rebased'))).toBe(true);
    });

    it('should fall through to normal rebase when merge-base check throws', async () => {
      const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

      // Configure mergeBase to throw — should fall through to rebase which succeeds
      const stub = ctx.gitOps as StubGitOps;
      stub.setFailure('mergeBase', new Error('fatal: not a valid ref'));

      await ctx.worktreeManager.create('task/test-branch', task.id);
      await ctx.worktreeManager.lock(task.id);
      const phase = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 1' });
      await ctx.taskPhaseStore.updatePhase(phase.id, { status: 'active', startedAt: now() });

      const run = await ctx.agentRunStore.createRun({
        taskId: task.id,
        agentType: 'scripted',
        mode: 'new',
      });

      await ctx.outcomeResolver.resolveAndTransition({
        taskId: task.id,
        result: { exitCode: 0, output: 'Done', outcome: 'pr_ready' },
        run: { id: run.id },
        worktree: { branch: 'task/test-branch', path: '/tmp/worktrees/' + task.id },
        worktreeManager: ctx.worktreeManager,
        phase: { id: phase.id },
        context: { workdir: '/tmp', mode: 'new' } as never,
      });

      // Should still succeed via normal rebase path
      const updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('pr_review');

      // Verify the rebase succeeded (not the merge-base skip)
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'git' });
      expect(events.some((e) => e.message.includes('rebase onto origin/main succeeded'))).toBe(true);
    });
  });

  describe('conflicts_detected outcome', () => {
    it('should self-transition implementing → implementing on rebase failure', async () => {
      const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

      // Configure rebase to fail (simulates merge conflict)
      (ctx.gitOps as StubGitOps).setFailure('rebase', new Error('CONFLICT (content): Merge conflict'));

      await ctx.worktreeManager.create('task/test-branch', task.id);
      await ctx.worktreeManager.lock(task.id);
      const phase = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 1' });
      await ctx.taskPhaseStore.updatePhase(phase.id, { status: 'active', startedAt: now() });

      const run = await ctx.agentRunStore.createRun({
        taskId: task.id,
        agentType: 'scripted',
        mode: 'new',
      });
      // Mark the run as completed so no_running_agent guard passes for self-transition
      await ctx.agentRunStore.updateRun(run.id, { status: 'completed', completedAt: now() });

      await ctx.outcomeResolver.resolveAndTransition({
        taskId: task.id,
        result: { exitCode: 0, output: 'Done', outcome: 'pr_ready' },
        run: { id: run.id },
        worktree: { branch: 'task/test-branch', path: '/tmp/worktrees/' + task.id },
        worktreeManager: ctx.worktreeManager,
        phase: { id: phase.id },
        context: { workdir: '/tmp', mode: 'new' } as never,
      });

      // Task should still be implementing (self-transition with conflicts_detected)
      const updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('implementing');

      // Verify the start_agent hook was called with revision mode (conflicts_detected)
      expect(startAgentCalls.some((c) => c.mode === 'revision')).toBe(true);

      // Verify event log records the conflict detection
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'git' });
      expect(events.some((e) => e.message.includes('conflicts'))).toBe(true);
    });
  });

  describe('failed outcome', () => {
    it('should attempt failure transition on non-zero exit code', async () => {
      const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

      await ctx.worktreeManager.create('task/test-branch', task.id);
      await ctx.worktreeManager.lock(task.id);
      const phase = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 1' });
      await ctx.taskPhaseStore.updatePhase(phase.id, { status: 'active', startedAt: now() });

      const run = await ctx.agentRunStore.createRun({
        taskId: task.id,
        agentType: 'scripted',
        mode: 'new',
      });
      // Mark the run as failed so no_running_agent guard passes for retry transition
      await ctx.agentRunStore.updateRun(run.id, { status: 'failed', completedAt: now() });

      await ctx.outcomeResolver.resolveAndTransition({
        taskId: task.id,
        result: { exitCode: 1, output: 'Error', outcome: 'failed' },
        run: { id: run.id },
        worktree: { branch: 'task/test-branch', path: '/tmp/worktrees/' + task.id },
        worktreeManager: ctx.worktreeManager,
        phase: { id: phase.id },
        context: { workdir: '/tmp', mode: 'new' } as never,
      });

      // Phase should be marked failed
      const phases = await ctx.taskPhaseStore.getPhasesForTask(task.id);
      expect(phases[0].status).toBe('failed');

      // Worktree should be unlocked
      const wt = await ctx.worktreeManager.get(task.id);
      expect(wt!.locked).toBe(false);

      // Task should still be implementing (failed self-transition via max_retries guard)
      const updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('implementing');
      expect(startAgentCalls.some((c) => c.mode === 'new')).toBe(true);
    });
  });
});
