import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';
import type { HookResult } from '../../src/shared/types';

describe('getTransitionsWithRecommendation', () => {
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

  // ─── Classification tests ────────────────────────────────────────────────

  it('should classify terminal statuses (done, closed) as escape', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    // 'closed' is a terminal status reachable from open via wildcard
    const escapeTargets = result.escape.map(t => t.to);
    expect(escapeTargets).toContain('closed');

    // escape transitions should not appear in forward or backward
    for (const et of result.escape) {
      expect(result.forward.map(t => t.to)).not.toContain(et.to);
      expect(result.backward.map(t => t.to)).not.toContain(et.to);
    }
  });

  it('should classify statuses without position (backlog) as escape', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    // 'backlog' has no position field, so it should be escape
    const escapeTargets = result.escape.map(t => t.to);
    expect(escapeTargets).toContain('backlog');
  });

  it('should classify transitions to higher positions as forward', async () => {
    // Task at 'open' (position 0) — transitions to triaging (0.5), designing (3), etc. are forward
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    const forwardTargets = result.forward.map(t => t.to);
    expect(forwardTargets).toContain('triaging');
    expect(forwardTargets).toContain('designing');
    expect(forwardTargets).toContain('planning');
    expect(forwardTargets).toContain('implementing');
  });

  it('should classify transitions to lower positions as backward', async () => {
    // Move task to plan_review (position 6) — transition back to planning (5) should be backward
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'plan_review');
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    const backwardTargets = result.backward.map(t => t.to);
    // plan_review (pos 6) → planning (pos 5) = backward
    expect(backwardTargets).toContain('planning');
  });

  it('should return all arrays disjoint and covering all transitions', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    const allClassified = [...result.forward, ...result.backward, ...result.escape];
    // Every transition should appear in exactly one classification
    expect(allClassified.length).toBe(result.transitions.length);
    const classifiedTos = allClassified.map(t => t.to).sort();
    const allTos = result.transitions.map(t => t.to).sort();
    expect(classifiedTos).toEqual(allTos);
  });

  // ─── Recommendation: human_review category ───────────────────────────────

  it('should recommend forward transition with lowest target position for human_review (plan_review)', async () => {
    // plan_review (position 6, category: human_review)
    // Forward transitions from plan_review: implementing (pos 7), pr_review (pos 8) etc.
    // Should recommend implementing (lowest forward position = 7)
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'plan_review');
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.to).toBe('implementing');
  });

  it('should recommend forward transition with lowest target position for human_review (design_review)', async () => {
    // design_review (position 4, category: human_review)
    // Forward transitions include planning (pos 5), implementing (pos 7)
    // Should recommend planning (lowest forward position = 5)
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'design_review');
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    expect(result.recommended).not.toBeNull();
    // The lowest forward position from design_review should be chosen
    const forwardPositions = result.forward.map(t => {
      const status = AGENT_PIPELINE.statuses.find(s => s.name === t.to);
      return { to: t.to, position: status?.position ?? Infinity };
    }).sort((a, b) => a.position - b.position);

    expect(result.recommended!.to).toBe(forwardPositions[0].to);
  });

  // ─── Recommendation: non-review category ─────────────────────────────────

  it('should recommend first forward transition in definition order for non-review statuses', async () => {
    // 'open' (position 0, category: ready) — should recommend first forward in definition order
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    expect(result.recommended).not.toBeNull();
    expect(result.forward.length).toBeGreaterThan(0);
    // Recommended should be the first forward transition
    expect(result.recommended!.to).toBe(result.forward[0].to);
  });

  // ─── Recommendation: fallback when no forward ────────────────────────────

  it('should fall back to non-escape transition when no forward transitions exist', async () => {
    // Create a pipeline where a status has only backward and escape transitions (no forward)
    const pipeline = await ctx.pipelineStore.createPipeline({
      name: 'Fallback Test',
      description: 'Tests fallback recommendation logic',
      statuses: [
        { name: 'start', label: 'Start', category: 'ready', position: 0 },
        { name: 'middle', label: 'Middle', category: 'ready', position: 5 },
        { name: 'archived', label: 'Archived', category: 'terminal', position: 10 },
      ],
      transitions: [
        // start → middle: needed to get the task to middle status
        { from: 'start', to: 'middle', trigger: 'manual', label: 'Go to Middle' },
        // From middle: only backward (start, pos 0 < 5) and escape (archived, terminal)
        { from: 'middle', to: 'start', trigger: 'manual', label: 'Back to Start' },
        { from: 'middle', to: 'archived', trigger: 'manual', label: 'Archive' },
      ],
      taskType: 'manual',
    });

    const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipeline.id));
    // Manually transition to middle
    await ctx.pipelineEngine.executeTransition(task, 'middle');
    const updatedTask = await ctx.taskStore.getTask(task.id);

    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(updatedTask!);

    // No forward transitions
    expect(result.forward).toHaveLength(0);
    // Should fall back to non-escape (backward) rather than escape
    expect(result.recommended).not.toBeNull();
    expect(result.recommended!.to).toBe('start'); // non-escape preferred
  });

  // ─── Edge case: no pipeline ──────────────────────────────────────────────

  it('should return empty result for non-existent pipeline', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
    const badTask = { ...task, pipelineId: 'non-existent' };

    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(badTask);

    expect(result).toEqual({
      transitions: [],
      recommended: null,
      forward: [],
      backward: [],
      escape: [],
    });
  });

  // ─── Edge case: no available transitions ─────────────────────────────────

  it('should return recommended: null when there are no manual transitions', async () => {
    // Create a custom pipeline with a status that has no manual transitions
    const pipeline = await ctx.pipelineStore.createPipeline({
      name: 'Isolated',
      description: 'Pipeline with isolated status',
      statuses: [
        { name: 'stuck', label: 'Stuck', category: 'ready', position: 0 },
      ],
      transitions: [],
      taskType: 'manual',
    });

    const task = await ctx.taskStore.createTask(
      createTaskInput(projectId, pipeline.id),
    );

    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    expect(result.transitions).toHaveLength(0);
    expect(result.recommended).toBeNull();
    expect(result.forward).toHaveLength(0);
    expect(result.backward).toHaveLength(0);
    expect(result.escape).toHaveLength(0);
  });

  // ─── Edge case: current status has no position ───────────────────────────

  it('should treat all non-escape transitions as forward when current status has no position', async () => {
    // Move task to backlog (no position) then check transitions
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'backlog');
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    // backlog only has one manual transition: backlog → open
    // 'open' has position 0 — but since current position is undefined, it's classified as forward
    expect(result.forward.length + result.escape.length).toBe(result.transitions.length);
    // No backward transitions (all non-escape treated as forward when no current position)
    expect(result.backward).toHaveLength(0);
  });

  // ─── Verify transitions field contains only manual transitions ───────────

  it('should only include manual transitions in the result', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    for (const t of result.transitions) {
      expect(t.trigger).toBe('manual');
    }
  });

  // ─── Wildcard transitions ────────────────────────────────────────────────

  it('should include wildcard (*) transitions in results', async () => {
    const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
    const result = await ctx.pipelineEngine.getTransitionsWithRecommendation(task);

    // The AGENT_PIPELINE has wildcard manual transitions (* → closed)
    const closedTransition = result.transitions.find(t => t.to === 'closed');
    expect(closedTransition).toBeDefined();
  });
});
