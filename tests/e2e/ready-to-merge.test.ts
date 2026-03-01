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

    it('should block non-admin user from merging', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      // Create a non-admin user in the database
      const userStore = new (await import('../../src/core/stores/sqlite-user-store')).SqliteUserStore(ctx.db);
      await userStore.createUser('regular-user', 'user');

      // Non-admin tries to merge the PR
      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'regular-user'
      });

      expect(result.success).toBe(false);
      expect(result.guardFailures).toBeDefined();
      expect(result.guardFailures).toHaveLength(1);
      expect(result.guardFailures![0].guard).toBe('is_admin');
      expect(result.guardFailures![0].reason).toContain('administrators');
    });

    it('should block merge when no actor is provided', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      // Try to merge without an actor
      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual'
      });

      expect(result.success).toBe(false);
      expect(result.guardFailures).toBeDefined();
      expect(result.guardFailures).toHaveLength(1);
      expect(result.guardFailures![0].guard).toBe('is_admin');
      expect(result.guardFailures![0].reason).toContain('No actor provided');
    });
  });

  describe('pipeline-bug-agent workflow', () => {
    it('should transition from pr_review to ready_to_merge on approval', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-bug-agent', { status: 'pr_review' })
      );

      // Manually approve the PR (without merge)
      const result = await ctx.pipelineEngine.executeTransition(task, 'ready_to_merge');
      expect(result.success).toBe(true);
      expect(result.task?.status).toBe('ready_to_merge');
    });

    it('should allow admin to merge from ready_to_merge to done', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-bug-agent', {
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

    it('should block non-admin user from merging in bug pipeline', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-bug-agent', { status: 'ready_to_merge' })
      );

      // Create a non-admin user in the database
      const userStore = new (await import('../../src/core/stores/sqlite-user-store')).SqliteUserStore(ctx.db);
      await userStore.createUser('bug-fixer', 'user');

      // Non-admin tries to merge the PR
      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'bug-fixer'
      });

      expect(result.success).toBe(false);
      expect(result.guardFailures).toBeDefined();
      expect(result.guardFailures).toHaveLength(1);
      expect(result.guardFailures![0].guard).toBe('is_admin');
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
  });
});