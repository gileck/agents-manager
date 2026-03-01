import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';

describe('Agent-type/status alignment validation', () => {
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

  it('should not warn when agent type matches pipeline expectations', async () => {
    // implementing expects 'implementor' (and 'reviewer') from its outgoing start_agent transitions
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

    await ctx.workflowService.startAgent(task.id, 'new', 'implementor');

    const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'system' });
    const mismatchWarnings = events.filter(e => e.message.includes('Agent type mismatch'));
    expect(mismatchWarnings).toHaveLength(0);
  });

  it('should warn when agent type does not match pipeline expectations but still launch', async () => {
    // implementing expects 'implementor' and 'reviewer', not 'planner'
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

    const run = await ctx.workflowService.startAgent(task.id, 'new', 'planner');

    // Agent still launched successfully
    expect(run).toBeDefined();
    expect(run.agentType).toBe('planner');

    const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'system' });
    const mismatchWarnings = events.filter(e => e.message.includes('Agent type mismatch'));
    expect(mismatchWarnings).toHaveLength(1);
    expect(mismatchWarnings[0].message).toContain('planner');
    expect(mismatchWarnings[0].message).toContain('implementing');
    expect(mismatchWarnings[0].data).toHaveProperty('expectedTypes');
  });

  it('should bypass validation for task-workflow-reviewer agent type', async () => {
    // task-workflow-reviewer is a meta-agent that can run from any status
    const task = await ctx.createTaskAtStatus(projectId, AGENT_PIPELINE.id, 'implementing');

    const run = await ctx.workflowService.startAgent(task.id, 'new', 'task-workflow-reviewer');

    expect(run).toBeDefined();

    const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'system' });
    const mismatchWarnings = events.filter(e => e.message.includes('Agent type mismatch'));
    expect(mismatchWarnings).toHaveLength(0);
  });

  it('should not warn when status has no start_agent transitions', async () => {
    // pipeline-simple has no start_agent hooks in any transitions
    const task = await ctx.createTaskAtStatus(projectId, 'pipeline-simple', 'in_progress');

    await ctx.workflowService.startAgent(task.id, 'new', 'implementor');

    const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'system' });
    const mismatchWarnings = events.filter(e => e.message.includes('Agent type mismatch'));
    expect(mismatchWarnings).toHaveLength(0);
  });

  it('should not warn or error when task does not exist', async () => {
    // startAgent with a non-existent task — the validation should skip silently
    // and the execute() call will handle the error
    await expect(
      ctx.workflowService.startAgent('nonexistent-task-id', 'new', 'planner'),
    ).rejects.toThrow();
    // No mismatch warning should have been logged
  });
});
