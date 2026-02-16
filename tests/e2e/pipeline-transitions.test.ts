import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { SIMPLE_PIPELINE } from '../../src/main/data/seeded-pipelines';

describe('Pipeline Transitions', () => {
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

  it('should execute a valid transition (open → in_progress)', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    expect(task.status).toBe('open');

    const result = ctx.pipelineEngine.executeTransition(task, 'in_progress');

    expect(result.success).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.task!.status).toBe('in_progress');
  });

  it('should execute full workflow (open → in_progress → done)', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    const result1 = ctx.pipelineEngine.executeTransition(task, 'in_progress');
    expect(result1.success).toBe(true);

    const result2 = ctx.pipelineEngine.executeTransition(result1.task!, 'done');
    expect(result2.success).toBe(true);
    expect(result2.task!.status).toBe('done');
  });

  it('should reject invalid transition (open → done)', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    const result = ctx.pipelineEngine.executeTransition(task, 'done');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No transition');
  });

  it('should allow backward transition (in_progress → open)', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    const result1 = ctx.pipelineEngine.executeTransition(task, 'in_progress');
    expect(result1.success).toBe(true);

    const result2 = ctx.pipelineEngine.executeTransition(result1.task!, 'open');
    expect(result2.success).toBe(true);
    expect(result2.task!.status).toBe('open');
  });

  it('should return valid transitions for a task', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    const transitions = ctx.pipelineEngine.getValidTransitions(task);
    expect(transitions).toHaveLength(1);
    expect(transitions[0].to).toBe('in_progress');
  });

  it('should return valid transitions filtered by trigger', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    const manualTransitions = ctx.pipelineEngine.getValidTransitions(task, 'manual');
    expect(manualTransitions).toHaveLength(1);

    const automaticTransitions = ctx.pipelineEngine.getValidTransitions(task, 'automatic');
    expect(automaticTransitions).toHaveLength(0);
  });

  it('should record transition history', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    ctx.pipelineEngine.executeTransition(task, 'in_progress', {
      trigger: 'manual',
      actor: 'test-user',
    });

    const rows = ctx.db.prepare('SELECT * FROM transition_history WHERE task_id = ?').all(task.id) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].from_status).toBe('open');
    expect(rows[0].to_status).toBe('in_progress');
    expect(rows[0].trigger).toBe('manual');
    expect(rows[0].actor).toBe('test-user');
  });

  it('should handle non-existent pipeline gracefully', () => {
    const task = ctx.taskStore.createTask(
      createTaskInput(projectId, SIMPLE_PIPELINE.id),
    );
    // Manually set a bad pipeline id
    const badTask = { ...task, pipelineId: 'non-existent' };

    const result = ctx.pipelineEngine.executeTransition(badTask, 'in_progress');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Pipeline not found');
  });
});
