import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { FEATURE_PIPELINE, SIMPLE_PIPELINE } from '../../src/main/data/seeded-pipelines';
import type { GuardResult } from '../../src/shared/types';

describe('Guard Validation', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeEach(() => {
    resetCounters();
    ctx = createTestContext();
    const project = ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('has_pr guard', () => {
    it('should pass when task has a PR link', () => {
      const task = ctx.taskStore.createTask(
        createTaskInput(projectId, FEATURE_PIPELINE.id, { prLink: 'https://github.com/org/repo/pull/1' }),
      );

      // Move to in_progress first
      const result1 = ctx.pipelineEngine.executeTransition(task, 'in_progress');
      expect(result1.success).toBe(true);

      // Now try to move to in_review (has has_pr guard)
      const result2 = ctx.pipelineEngine.executeTransition(result1.task!, 'in_review');
      expect(result2.success).toBe(true);
      expect(result2.task!.status).toBe('in_review');
    });

    it('should fail when task has no PR link', () => {
      const task = ctx.taskStore.createTask(createTaskInput(projectId, FEATURE_PIPELINE.id));

      // Move to in_progress first
      const result1 = ctx.pipelineEngine.executeTransition(task, 'in_progress');
      expect(result1.success).toBe(true);

      // Now try to move to in_review (has has_pr guard)
      const result2 = ctx.pipelineEngine.executeTransition(result1.task!, 'in_review');
      expect(result2.success).toBe(false);
      expect(result2.guardFailures).toBeDefined();
      expect(result2.guardFailures).toHaveLength(1);
      expect(result2.guardFailures![0].guard).toBe('has_pr');
      expect(result2.guardFailures![0].reason).toContain('PR link');
    });
  });

  describe('dependencies_resolved guard', () => {
    it('should pass when all dependencies are in final status', () => {
      // Create a pipeline with dependencies_resolved guard
      const customPipeline = ctx.pipelineStore.createPipeline({
        name: 'With Deps Guard',
        taskType: 'deps-test',
        statuses: [
          { name: 'open', label: 'Open' },
          { name: 'ready', label: 'Ready' },
          { name: 'done', label: 'Done', isFinal: true },
        ],
        transitions: [
          { from: 'open', to: 'ready', trigger: 'manual', guards: [{ name: 'dependencies_resolved' }] },
          { from: 'ready', to: 'done', trigger: 'manual' },
        ],
      });

      const dep = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
      const task = ctx.taskStore.createTask(createTaskInput(projectId, customPipeline.id));
      ctx.taskStore.addDependency(task.id, dep.id);

      // Complete the dependency (open → in_progress → done)
      const r1 = ctx.pipelineEngine.executeTransition(dep, 'in_progress');
      ctx.pipelineEngine.executeTransition(r1.task!, 'done');

      // Now transition the dependent task
      const result = ctx.pipelineEngine.executeTransition(task, 'ready');
      expect(result.success).toBe(true);
    });

    it('should fail when dependencies are not resolved', () => {
      const customPipeline = ctx.pipelineStore.createPipeline({
        name: 'With Deps Guard 2',
        taskType: 'deps-test-2',
        statuses: [
          { name: 'open', label: 'Open' },
          { name: 'ready', label: 'Ready' },
          { name: 'done', label: 'Done', isFinal: true },
        ],
        transitions: [
          { from: 'open', to: 'ready', trigger: 'manual', guards: [{ name: 'dependencies_resolved' }] },
          { from: 'ready', to: 'done', trigger: 'manual' },
        ],
      });

      const dep = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
      const task = ctx.taskStore.createTask(createTaskInput(projectId, customPipeline.id));
      ctx.taskStore.addDependency(task.id, dep.id);

      // Don't complete the dependency
      const result = ctx.pipelineEngine.executeTransition(task, 'ready');
      expect(result.success).toBe(false);
      expect(result.guardFailures).toBeDefined();
      expect(result.guardFailures![0].guard).toBe('dependencies_resolved');
      expect(result.guardFailures![0].reason).toContain('unresolved');
    });
  });

  describe('custom guard registration', () => {
    it('should allow registering and using custom guards', () => {
      ctx.pipelineEngine.registerGuard('custom_check', (task): GuardResult => {
        if (task.assignee) {
          return { allowed: true };
        }
        return { allowed: false, reason: 'Task must have an assignee' };
      });

      const customPipeline = ctx.pipelineStore.createPipeline({
        name: 'Custom Guard Pipeline',
        taskType: 'custom-guard',
        statuses: [
          { name: 'open', label: 'Open' },
          { name: 'assigned', label: 'Assigned' },
        ],
        transitions: [
          { from: 'open', to: 'assigned', trigger: 'manual', guards: [{ name: 'custom_check' }] },
        ],
      });

      // Without assignee - should fail
      const task1 = ctx.taskStore.createTask(createTaskInput(projectId, customPipeline.id));
      const result1 = ctx.pipelineEngine.executeTransition(task1, 'assigned');
      expect(result1.success).toBe(false);

      // With assignee - should pass
      const task2 = ctx.taskStore.createTask(
        createTaskInput(projectId, customPipeline.id, { assignee: 'dev1' }),
      );
      const result2 = ctx.pipelineEngine.executeTransition(task2, 'assigned');
      expect(result2.success).toBe(true);
    });
  });
});
