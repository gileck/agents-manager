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

    it('should transition implementing → ready_to_merge when branch HEAD equals origin/main (already on main)', async () => {
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
      expect(updatedTask!.status).toBe('ready_to_merge');

      // Verify event log records the already_on_main detection
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'agent' });
      expect(events.some((e) => e.message.includes('already merged'))).toBe(true);
    });
  });

  describe('uncommitted_changes outcome', () => {
    it('should self-transition implementing → implementing on first detection (resume agent)', async () => {
      const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

      // Configure: empty committed diff but worktree has uncommitted changes
      const stub = ctx.gitOps as StubGitOps;
      stub.diffOverride = '';
      stub.statusOverride = 'M src/file.ts';
      stub.revParseMap = new Map([['HEAD', 'aaa111'], ['origin/main', 'bbb222']]);

      await ctx.worktreeManager.create('task/test-branch', task.id);
      await ctx.worktreeManager.lock(task.id);
      const phase = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 1' });
      await ctx.taskPhaseStore.updatePhase(phase.id, { status: 'active', startedAt: now() });

      const run = await ctx.agentRunStore.createRun({
        taskId: task.id,
        agentType: 'scripted',
        mode: 'new',
      });
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

      // Task stays in implementing (self-transition) — agent will be resumed
      const updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('implementing');

      // Verify start_agent hook fired with revision mode
      expect(startAgentCalls.some((c) => c.mode === 'revision')).toBe(true);

      // Verify event log records the uncommitted changes detection
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'agent' });
      expect(events.some((e) => e.message.includes('uncommitted changes'))).toBe(true);
    });

    it('should discard changes and transition to open on second detection (retry exhausted)', async () => {
      const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

      // Configure: empty committed diff but worktree has uncommitted changes
      const stub = ctx.gitOps as StubGitOps;
      stub.diffOverride = '';
      stub.statusOverride = 'M src/file.ts';
      stub.revParseMap = new Map([['HEAD', 'aaa111'], ['origin/main', 'bbb222']]);

      await ctx.worktreeManager.create('task/test-branch', task.id);
      await ctx.worktreeManager.lock(task.id);
      const phase = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 1' });
      await ctx.taskPhaseStore.updatePhase(phase.id, { status: 'active', startedAt: now() });

      // First attempt — triggers self-transition (uses up the 1 allowed retry)
      const run1 = await ctx.agentRunStore.createRun({
        taskId: task.id,
        agentType: 'scripted',
        mode: 'new',
      });
      await ctx.agentRunStore.updateRun(run1.id, { status: 'completed', completedAt: now() });

      await ctx.outcomeResolver.resolveAndTransition({
        taskId: task.id,
        result: { exitCode: 0, output: 'Done', outcome: 'pr_ready' },
        run: { id: run1.id },
        worktree: { branch: 'task/test-branch', path: '/tmp/worktrees/' + task.id },
        worktreeManager: ctx.worktreeManager,
        phase: { id: phase.id },
        context: { workdir: '/tmp', mode: 'new' } as never,
      });

      // First detection: self-transition succeeded
      let updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('implementing');

      // Second attempt — context.revisionReason='uncommitted_changes' triggers discard + no_changes
      const run2 = await ctx.agentRunStore.createRun({
        taskId: task.id,
        agentType: 'scripted',
        mode: 'revision',
      });
      await ctx.agentRunStore.updateRun(run2.id, { status: 'completed', completedAt: now() });
      const phase2 = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 1 retry' });
      await ctx.taskPhaseStore.updatePhase(phase2.id, { status: 'active', startedAt: now() });

      await ctx.outcomeResolver.resolveAndTransition({
        taskId: task.id,
        result: { exitCode: 0, output: 'Done', outcome: 'pr_ready' },
        run: { id: run2.id },
        worktree: { branch: 'task/test-branch', path: '/tmp/worktrees/' + task.id },
        worktreeManager: ctx.worktreeManager,
        phase: { id: phase2.id },
        context: { workdir: '/tmp', mode: 'revision', revisionReason: 'uncommitted_changes' } as never,
      });

      // Second detection: falls through to open
      updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('open');

      // Verify event log records the retry exhaustion
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'agent' });
      expect(events.some((e) => e.message.includes('retry exhausted'))).toBe(true);
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

      // Task should still be implementing (self-transition with conflicts_detected outcome)
      const updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('implementing');

      // Verify the start_agent hook was called with revision mode (merge_failed)
      expect(startAgentCalls.some((c) => c.mode === 'revision')).toBe(true);

      // Verify event log records the conflict detection
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'git' });
      expect(events.some((e) => e.message.includes('conflicts'))).toBe(true);
    });

    it('should detect conflicts against integration branch for multi-phase tasks', async () => {
      // Bug fix: outcome resolver was always checking against origin/main,
      // but multi-phase tasks need to check against origin/<taskBranch>.
      // This caused conflicts between duplicate Phase 1 commits (original vs squash-merged)
      // to be missed, leading to push_and_create_pr hook failure and a stuck task loop.
      const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing', {
        phases: [
          { id: 'phase-1', name: 'Phase 1', status: 'completed', subtasks: [] },
          { id: 'phase-2', name: 'Phase 2', status: 'in_progress', subtasks: [] },
        ],
        metadata: { taskBranch: 'task/test-task/integration' },
      });

      // Configure rebase to fail — simulates conflict between agent's main-based history
      // and the integration branch's squash-merged Phase 1 commit
      (ctx.gitOps as StubGitOps).setFailure('rebase', new Error('CONFLICT: rebase onto integration failed'));

      await ctx.worktreeManager.create('task/test-branch', task.id);
      await ctx.worktreeManager.lock(task.id);
      const phase = await ctx.taskPhaseStore.createPhase({ taskId: task.id, phase: 'Phase 2' });
      await ctx.taskPhaseStore.updatePhase(phase.id, { status: 'active', startedAt: now() });

      const run = await ctx.agentRunStore.createRun({
        taskId: task.id,
        agentType: 'scripted',
        mode: 'new',
      });
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

      // Conflict should be detected and task should self-transition via conflicts_detected
      const updatedTask = await ctx.taskStore.getTask(task.id);
      expect(updatedTask!.status).toBe('implementing');

      // Verify the conflict log references the integration branch, not origin/main
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'git' });
      expect(events.some((e) => e.message.includes('origin/task/test-task/integration'))).toBe(true);
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
