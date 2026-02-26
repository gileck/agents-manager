import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';

describe('Admin Merge Guard', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;

    // Import and create user store
    const { SqliteUserStore } = await import('../../src/main/stores/sqlite-user-store');
    const userStore = new SqliteUserStore(ctx.db);

    // Create test users
    await userStore.createUser('admin-user', 'admin');
    await userStore.createUser('regular-user', 'user');
    await userStore.createUser('another-user', 'user');
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('is_admin guard functionality', () => {
    it('should allow admin users to perform guarded transitions', async () => {
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

      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'admin-user'
      });

      expect(result.success).toBe(true);
      expect(result.guardFailures).toBeUndefined();
    });

    it('should block regular users from performing admin-only transitions', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'regular-user'
      });

      expect(result.success).toBe(false);
      expect(result.guardFailures).toHaveLength(1);
      expect(result.guardFailures![0]).toMatchObject({
        guard: 'is_admin',
        reason: 'Only administrators can perform this action'
      });
    });

    it('should block unknown users', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'unknown-user'
      });

      expect(result.success).toBe(false);
      expect(result.guardFailures).toHaveLength(1);
      expect(result.guardFailures![0]).toMatchObject({
        guard: 'is_admin',
        reason: 'User not found'
      });
    });

    it('should block when no actor is provided', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual'
        // no actor provided
      });

      expect(result.success).toBe(false);
      expect(result.guardFailures).toHaveLength(1);
      expect(result.guardFailures![0]).toMatchObject({
        guard: 'is_admin',
        reason: 'No actor provided - admin role required'
      });
    });

    it('should work with default admin user from migration', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', {
          status: 'ready_to_merge',
          prLink: 'https://github.com/org/repo/pull/123'
        })
      );

      // Create PR artifact so merge_pr hook doesn't fail
      await ctx.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'pr',
        data: { url: 'https://github.com/org/repo/pull/123', number: 123, title: 'Test PR' }
      });

      const result = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'admin' // default admin from migration
      });

      expect(result.success).toBe(true);
    });
  });

  describe('transition history tracking', () => {
    it('should record the actor in transition history', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      // Create PR artifact
      await ctx.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'pr',
        data: { url: 'https://github.com/org/repo/pull/3', number: 3, title: 'Test PR' }
      });

      await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'admin-user'
      });

      // Check transition history
      const history = ctx.db.prepare(`
        SELECT * FROM transition_history
        WHERE task_id = ? AND from_status = ? AND to_status = ?
      `).get(task.id, 'ready_to_merge', 'done') as { id: string; actor: string; trigger: string; guard_results: string } | undefined;

      expect(history).toBeDefined();
      expect(history.actor).toBe('admin-user');
      expect(history.trigger).toBe('manual');

      const guardResults = JSON.parse(history.guard_results);
      expect(guardResults.is_admin).toMatchObject({
        allowed: true
      });
    });

    it('should record guard failure in transition history for non-admin', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-agent', { status: 'ready_to_merge' })
      );

      await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'regular-user'
      });

      // Since the transition failed, there should be no history entry
      const history = ctx.db.prepare(`
        SELECT * FROM transition_history
        WHERE task_id = ? AND from_status = ? AND to_status = ?
      `).get(task.id, 'ready_to_merge', 'done');

      expect(history).toBeUndefined();
    });
  });

  describe('multiple pipelines', () => {
    it('should enforce admin guard in bug-agent pipeline', async () => {
      const task = await ctx.taskStore.createTask(
        createTaskInput(projectId, 'pipeline-bug-agent', {
          status: 'ready_to_merge',
          prLink: 'https://github.com/org/repo/pull/2'
        })
      );

      // Non-admin attempt
      const result1 = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'regular-user'
      });
      expect(result1.success).toBe(false);
      expect(result1.guardFailures![0].guard).toBe('is_admin');

      // Create PR artifact for admin attempt
      await ctx.taskArtifactStore.createArtifact({
        taskId: task.id,
        type: 'pr',
        data: { url: 'https://github.com/org/repo/pull/2', number: 2, title: 'Bug Fix PR' }
      });

      // Admin attempt
      const result2 = await ctx.pipelineEngine.executeTransition(task, 'done', {
        trigger: 'manual',
        actor: 'admin-user'
      });
      expect(result2.success).toBe(true);
    });
  });
});