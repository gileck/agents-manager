import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';

describe('Ready to Merge Flow', () => {
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

  describe('pipeline-agent workflow', () => {
    it('should transition from pr_review to ready_to_merge on approval', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'pr_review' })
      );

      // Manually approve the PR (without merge)
      const result = await ctx.pipelineEngine.executeTransition(task, 'ready_to_merge');
      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('ready_to_merge');
    });

    it('should transition from pr_review to ready_to_merge on agent approval', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'pr_review' })
      );

      // Simulate agent approving the PR
      const result = await ctx.pipelineEngine.executeTransition(task, 'ready_to_merge', {
        trigger: 'agent',
        data: { agentOutcome: 'approved' }
      });
      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('ready_to_merge');
    });

    it('should allow admin to merge from ready_to_merge to done', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', {
          status: 'ready_to_merge',
          prLink: 'https://github.com/org/repo/pull/1'
        })
      );

      // Create PR artifact so merge_pr hook doesn't fail
      await ctx.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'pr',
        data: { url: 'https://github.com/org/repo/pull/1', number: 1, title: 'Test PR' }
      });

      // Admin merges the PR
      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'admin'
      });
      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('done');
    });

    it('should allow non-admin user to merge (no admin guard on merge transition)', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      // Create a non-admin user in the database
      const userStore = new (await import('../../src/core/stores/sqlite-user-store')).SqliteUserStore(ctx.db);
      await userStore.createUser('regular-user', 'user');

      // Create PR artifact so merge_pr hook succeeds
      await ctx.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'pr',
        data: { url: 'https://github.com/org/repo/pull/1', number: 1, title: 'Test PR' }
      });

      // Non-admin can now merge — admin guard has been removed from merge transition
      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'regular-user'
      });

      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('done');
      expect(result.guardFailures).toBeUndefined();
    });

    it('should allow merge without an actor', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      // Create PR artifact so merge_pr hook succeeds
      await ctx.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'pr',
        data: { url: 'https://github.com/org/repo/pull/1', number: 1, title: 'Test PR' }
      });

      // Merge without an actor — no admin guard requires one
      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual'
      });

      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('done');
      expect(result.guardFailures).toBeUndefined();
    });
  });

  describe('investigation pipeline workflow', () => {
    it('should transition from pr_review to ready_to_merge on approval (investigation path)', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'pr_review' })
      );

      // Manually approve the PR (without merge)
      const result = await ctx.pipelineEngine.executeTransition(task, 'ready_to_merge');
      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('ready_to_merge');
    });

    it('should allow admin to merge from ready_to_merge to done (investigation path)', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', {
          status: 'ready_to_merge',
          prLink: 'https://github.com/org/repo/pull/2'
        })
      );

      // Create PR artifact so merge_pr hook doesn't fail
      await ctx.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'pr',
        data: { url: 'https://github.com/org/repo/pull/2', number: 2, title: 'Bug Fix PR' }
      });

      // Admin merges the PR
      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'admin'
      });
      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('done');
    });

    it('should allow non-admin user to merge (no admin guard on merge transition)', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      // Create a non-admin user in the database
      const userStore = new (await import('../../src/core/stores/sqlite-user-store')).SqliteUserStore(ctx.db);
      await userStore.createUser('bug-fixer', 'user');

      // Create PR artifact so merge_pr hook succeeds
      await ctx.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'pr',
        data: { url: 'https://github.com/org/repo/pull/1', number: 1, title: 'Test PR' }
      });

      // Non-admin can now merge — admin guard has been removed
      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'bug-fixer'
      });

      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('done');
      expect(result.guardFailures).toBeUndefined();
    });
  });

  describe('merge failure recovery', () => {
    it('should allow returning to ready_to_merge from done if merge fails', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'done' })
      );

      // Simulate merge failure recovery
      const result = await ctx.pipelineEngine.executeTransition(task, 'ready_to_merge', {
        trigger: 'manual',
        actor: 'admin'
      });
      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('ready_to_merge');
    });

    it('should allow system-trigger transition from ready_to_merge to implementing (merge_failed auto-recovery)', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      // System trigger: auto-recovery when merge_pr hook fails
      const result = await ctx.pipelineEngine.executeTransition(task, 'implementing', {
        trigger: 'system',
      });
      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('implementing');
    });
  });
});