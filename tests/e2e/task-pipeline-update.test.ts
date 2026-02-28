import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import type { Pipeline } from '../../src/shared/types';

describe('Task Pipeline Update', () => {
  let ctx: TestContext;
  let projectId: string;
  let pipeline1: Pipeline;
  let pipeline2: Pipeline;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;

    // Create two pipelines with different statuses
    pipeline1 = await ctx.pipelineStore.createPipeline({
      name: 'Pipeline One',
      taskType: 'development',
      statuses: [
        { name: 'backlog', label: 'Backlog' },
        { name: 'in_progress', label: 'In Progress' },
        { name: 'review', label: 'Review' },
        { name: 'done', label: 'Done', isFinal: true },
      ],
      transitions: [
        { from: 'backlog', to: 'in_progress', trigger: 'manual' },
        { from: 'in_progress', to: 'review', trigger: 'manual' },
        { from: 'review', to: 'done', trigger: 'manual' },
      ],
    });

    pipeline2 = await ctx.pipelineStore.createPipeline({
      name: 'Pipeline Two',
      taskType: 'test-bug',
      statuses: [
        { name: 'new', label: 'New' },
        { name: 'in_progress', label: 'In Progress' }, // Same name as pipeline1
        { name: 'testing', label: 'Testing' },
        { name: 'closed', label: 'Closed', isFinal: true },
      ],
      transitions: [
        { from: 'new', to: 'in_progress', trigger: 'manual' },
        { from: 'in_progress', to: 'testing', trigger: 'manual' },
        { from: 'testing', to: 'closed', trigger: 'manual' },
      ],
    });
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should update task pipeline when status name exists in both pipelines', async () => {
    // Create task in pipeline1
    const task = await ctx.workflowService.createTask(createTaskInput(projectId, pipeline1.id));

    // Transition to in_progress
    await ctx.workflowService.transitionTask(task.id, 'in_progress');

    // Update task to use pipeline2
    const updated = await ctx.workflowService.updateTask(task.id, { pipelineId: pipeline2.id });

    expect(updated).not.toBeNull();
    expect(updated!.pipelineId).toBe(pipeline2.id);
    expect(updated!.status).toBe('in_progress'); // Status should be preserved
  });

  it('should reset to first status when current status does not exist in new pipeline', async () => {
    // Create task in pipeline1
    const task = await ctx.workflowService.createTask(createTaskInput(projectId, pipeline1.id));

    // Transition to review (which doesn't exist in pipeline2)
    await ctx.workflowService.transitionTask(task.id, 'in_progress');
    await ctx.workflowService.transitionTask(task.id, 'review');

    // Update task to use pipeline2
    const updated = await ctx.workflowService.updateTask(task.id, { pipelineId: pipeline2.id });

    expect(updated).not.toBeNull();
    expect(updated!.pipelineId).toBe(pipeline2.id);
    expect(updated!.status).toBe('new'); // Should reset to first status

    // Check that a warning was logged
    const events = await ctx.taskEventLog.getEvents({ taskId: task.id });
    const warningEvent = events.find((e) =>
      e.category === 'system' &&
      e.severity === 'warning' &&
      e.message.includes('not found in new pipeline')
    );
    expect(warningEvent).toBeDefined();
  });

  it('should fail to update pipeline when agent is running', async () => {
    // Create task
    const task = await ctx.workflowService.createTask(createTaskInput(projectId, pipeline1.id));

    // Create a running agent
    await ctx.agentRunStore.createRun({ taskId: task.id, agentType: 'test-agent', mode: 'new' });

    // Try to update pipeline
    await expect(
      ctx.workflowService.updateTask(task.id, { pipelineId: pipeline2.id })
    ).rejects.toThrow('Cannot change pipeline while agent is running');
  });

  it('should fail when trying to update to non-existent pipeline', async () => {
    // Create task
    const task = await ctx.workflowService.createTask(createTaskInput(projectId, pipeline1.id));

    // Try to update to non-existent pipeline
    await expect(
      ctx.workflowService.updateTask(task.id, { pipelineId: 'non-existent' })
    ).rejects.toThrow('Pipeline not found');
  });

  it('should preserve task data when changing pipelines', async () => {
    // Create task with data
    const task = await ctx.workflowService.createTask({
      ...createTaskInput(projectId, pipeline1.id),
      description: 'Test description',
      priority: 5,
      assignee: 'test-user',
      tags: ['tag1', 'tag2'],
      subtasks: [
        { name: 'Subtask 1', status: 'open' },
      ],
    });

    // Update pipeline
    const updated = await ctx.workflowService.updateTask(task.id, { pipelineId: pipeline2.id });

    expect(updated).not.toBeNull();
    expect(updated!.pipelineId).toBe(pipeline2.id);
    expect(updated!.description).toBe('Test description');
    expect(updated!.priority).toBe(5);
    expect(updated!.assignee).toBe('test-user');
    expect(updated!.tags).toEqual(['tag1', 'tag2']);
    expect(updated!.subtasks).toHaveLength(1);
    expect(updated!.subtasks[0].name).toBe('Subtask 1');
  });

  it('should clear phases when changing pipelines', async () => {
    // Create task with phases
    const task = await ctx.workflowService.createTask({
      ...createTaskInput(projectId, pipeline1.id),
      phases: [
        { id: 'phase-1', name: 'Phase 1', status: 'completed', subtasks: [] },
        { id: 'phase-2', name: 'Phase 2', status: 'pending', subtasks: [] },
      ],
    });

    // Update pipeline
    const updated = await ctx.workflowService.updateTask(task.id, { pipelineId: pipeline2.id });

    expect(updated).not.toBeNull();
    expect(updated!.pipelineId).toBe(pipeline2.id);
    expect(updated!.phases).toBeNull();

    // Check that an info log was created
    const events = await ctx.taskEventLog.getEvents({ taskId: task.id });
    const phasesClearedEvent = events.find((e) =>
      e.category === 'system' &&
      e.message === 'Clearing phases due to pipeline change'
    );
    expect(phasesClearedEvent).toBeDefined();
  });

  it('should log pipeline change in activity log', async () => {
    // Create task
    const task = await ctx.workflowService.createTask(createTaskInput(projectId, pipeline1.id));

    // Update pipeline
    await ctx.workflowService.updateTask(task.id, { pipelineId: pipeline2.id });

    // Check activity log
    const activities = await ctx.activityLog.getEntries({ entityId: task.id });
    const pipelineChangeActivity = activities.find((a) =>
      a.action === 'update' &&
      a.entityType === 'task' &&
      a.summary.includes('Changed pipeline')
    );
    expect(pipelineChangeActivity).toBeDefined();
    expect(pipelineChangeActivity!.data).toMatchObject({
      oldPipeline: pipeline1.id,
      newPipeline: pipeline2.id,
    });
  });

  it('should log field update event for pipeline change', async () => {
    // Create task
    const task = await ctx.workflowService.createTask(createTaskInput(projectId, pipeline1.id));

    // Update pipeline
    await ctx.workflowService.updateTask(task.id, { pipelineId: pipeline2.id });

    // Check task events
    const events = await ctx.taskEventLog.getEvents({ taskId: task.id });
    const fieldUpdateEvent = events.find((e) =>
      e.category === 'field_update' &&
      e.message.includes('Pipeline changed')
    );
    expect(fieldUpdateEvent).toBeDefined();
    expect(fieldUpdateEvent!.data).toMatchObject({
      oldPipeline: pipeline1.id,
      newPipeline: pipeline2.id,
    });
  });

  it('should allow updating other fields along with pipeline', async () => {
    // Create task
    const task = await ctx.workflowService.createTask(createTaskInput(projectId, pipeline1.id));

    // Update multiple fields including pipeline
    const updated = await ctx.workflowService.updateTask(task.id, {
      pipelineId: pipeline2.id,
      title: 'Updated Title',
      assignee: 'new-user',
    });

    expect(updated).not.toBeNull();
    expect(updated!.pipelineId).toBe(pipeline2.id);
    expect(updated!.title).toBe('Updated Title');
    expect(updated!.assignee).toBe('new-user');
  });

  it('should handle pipeline update when task has dependencies', async () => {
    // Create parent task
    const parentTask = await ctx.workflowService.createTask(createTaskInput(projectId, pipeline1.id));

    // Create dependent task
    const depTask = await ctx.workflowService.createTask({
      ...createTaskInput(projectId, pipeline1.id),
      title: 'Dependent Task',
    });

    // Add dependency
    await ctx.taskStore.addDependency(depTask.id, parentTask.id);

    // Update pipeline of the parent task
    const updated = await ctx.workflowService.updateTask(parentTask.id, { pipelineId: pipeline2.id });
    expect(updated).not.toBeNull();

    // Verify dependency is preserved
    const deps = await ctx.taskStore.getDependencies(depTask.id);
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe(parentTask.id);
  });
});