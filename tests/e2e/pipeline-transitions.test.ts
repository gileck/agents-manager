import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';
import type { HookResult } from '../../src/shared/types';

describe('Pipeline Transitions', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();

    // Register stub hooks so agent-starting transitions succeed
    ctx.pipelineEngine.registerHook('start_agent', async (): Promise<HookResult> => {
      return { success: true };
    });

    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should execute a valid transition (open → designing)', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
    expect(task.status).toBe('open');

    const result = await ctx.pipelineEngine.executeTransition(task, 'designing');

    expect(result.success).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.task!.status).toBe('designing');
  });

  it('should execute agent-driven workflow (open → designing → design_review → implementing)', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));

    // open → designing (manual)
    const result1 = await ctx.pipelineEngine.executeTransition(task, 'designing');
    expect(result1.success).toBe(true);

    // designing → design_review (agent outcome)
    const result2 = await ctx.pipelineEngine.executeTransition(result1.task!, 'design_review', {
      trigger: 'agent',
      agentOutcome: 'design_ready',
    });
    expect(result2.success).toBe(true);

    // design_review → implementing (manual)
    const result3 = await ctx.pipelineEngine.executeTransition(result2.task!, 'implementing');
    expect(result3.success).toBe(true);
    expect(result3.task!.status).toBe('implementing');
  });

  it('should reject invalid transition (open → done)', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));

    const result = await ctx.pipelineEngine.executeTransition(task, 'done');

    expect(result.success).toBe(false);
    expect(result.error).toContain('No transition');
  });

  it('should allow cancel transition (designing → open)', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));

    const result1 = await ctx.pipelineEngine.executeTransition(task, 'designing');
    expect(result1.success).toBe(true);

    const result2 = await ctx.pipelineEngine.executeTransition(result1.task!, 'open');
    expect(result2.success).toBe(true);
    expect(result2.task!.status).toBe('open');
  });

  it('should return valid transitions for a task', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));

    const transitions = await ctx.pipelineEngine.getValidTransitions(task);
    // open has 4 manual transitions: investigating, designing, planning, implementing
    expect(transitions.length).toBe(4);
    const targets = transitions.map((t) => t.to);
    expect(targets).toContain('investigating');
    expect(targets).toContain('designing');
    expect(targets).toContain('planning');
    expect(targets).toContain('implementing');
  });

  it('should return valid transitions filtered by trigger', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));

    const manualTransitions = await ctx.pipelineEngine.getValidTransitions(task, 'manual');
    expect(manualTransitions.length).toBe(4);

    const automaticTransitions = await ctx.pipelineEngine.getValidTransitions(task, 'automatic');
    expect(automaticTransitions).toHaveLength(0);
  });

  it('should record transition history', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));

    await ctx.pipelineEngine.executeTransition(task, 'designing', {
      trigger: 'manual',
      actor: 'test-user',
    });

    const rows = ctx.getTransitionHistory(task.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].from_status).toBe('open');
    expect(rows[0].to_status).toBe('designing');
    expect(rows[0].trigger).toBe('manual');
    expect(rows[0].actor).toBe('test-user');
  });

  it('should handle non-existent pipeline gracefully', async () => {
    const task = await ctx.taskStore.createTask(
      createTaskInput(projectId, AGENT_PIPELINE.id),
    );
    // Manually set a bad pipeline id
    const badTask = { ...task, pipelineId: 'non-existent' };

    const result = await ctx.pipelineEngine.executeTransition(badTask, 'designing');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Pipeline not found');
  });
});
