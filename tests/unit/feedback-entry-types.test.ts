import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';
import { FEEDBACK_ENTRY_TYPES } from '../../src/shared/types';

describe('WorkflowService.addTaskFeedback – entry type validation', () => {
  let ctx: TestContext;
  let taskId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();

    const project = await ctx.projectStore.createProject(createProjectInput());
    const task = await ctx.taskStore.createTask(createTaskInput(project.id, AGENT_PIPELINE.id));
    taskId = task.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should accept post_mortem_feedback as a valid entry type', async () => {
    const entry = await ctx.workflowService.addTaskFeedback(
      taskId,
      'post_mortem_feedback',
      'Post-mortem review comment',
    );

    expect(entry).toBeDefined();
    expect(entry.entryType).toBe('post_mortem_feedback');
    expect(entry.summary).toBe('Post-mortem review comment');
  });

  it('should accept all declared FEEDBACK_ENTRY_TYPES', async () => {
    for (const entryType of FEEDBACK_ENTRY_TYPES) {
      const entry = await ctx.workflowService.addTaskFeedback(
        taskId,
        entryType,
        `Feedback of type ${entryType}`,
      );
      expect(entry.entryType).toBe(entryType);
    }
  });

  it('should reject unknown feedback entry types', async () => {
    await expect(
      ctx.workflowService.addTaskFeedback(taskId, 'invalid_feedback', 'Should fail'),
    ).rejects.toThrow('Invalid feedback entry type: invalid_feedback');
  });
});
