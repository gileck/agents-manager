import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';
import { SIMPLE_PIPELINE } from '../../src/main/data/seeded-pipelines';

describe('Event Logging', () => {
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

  it('should log status_change event on transition', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    ctx.pipelineEngine.executeTransition(task, 'in_progress');

    const events = ctx.taskEventLog.getEvents({ taskId: task.id, category: 'status_change' });
    expect(events).toHaveLength(1);
    expect(events[0].message).toContain('open');
    expect(events[0].message).toContain('in_progress');
    expect(events[0].data).toEqual(expect.objectContaining({
      fromStatus: 'open',
      toStatus: 'in_progress',
    }));
  });

  it('should filter events by category', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));
    ctx.pipelineEngine.executeTransition(task, 'in_progress');

    // Add a system event manually
    ctx.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      message: 'Test system event',
    });

    const statusEvents = ctx.taskEventLog.getEvents({ category: 'status_change' });
    expect(statusEvents).toHaveLength(1);

    const systemEvents = ctx.taskEventLog.getEvents({ category: 'system' });
    expect(systemEvents).toHaveLength(1);
    expect(systemEvents[0].message).toBe('Test system event');
  });

  it('should filter events by severity', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    ctx.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      severity: 'info',
      message: 'Info event',
    });
    ctx.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      severity: 'warning',
      message: 'Warning event',
    });
    ctx.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      severity: 'error',
      message: 'Error event',
    });

    const warnings = ctx.taskEventLog.getEvents({ severity: 'warning' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe('Warning event');

    const errors = ctx.taskEventLog.getEvents({ severity: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('Error event');
  });

  it('should filter events by time range', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    const before = Date.now();
    ctx.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      message: 'Event 1',
    });
    const after = Date.now() + 1;

    ctx.taskEventLog.log({
      taskId: task.id,
      category: 'system',
      message: 'Event 2',
    });

    const events = ctx.taskEventLog.getEvents({ since: before, until: after });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('should return events in chronological order', () => {
    const task = ctx.taskStore.createTask(createTaskInput(projectId, SIMPLE_PIPELINE.id));

    ctx.taskEventLog.log({ taskId: task.id, category: 'system', message: 'First' });
    ctx.taskEventLog.log({ taskId: task.id, category: 'system', message: 'Second' });
    ctx.taskEventLog.log({ taskId: task.id, category: 'system', message: 'Third' });

    const events = ctx.taskEventLog.getEvents({ taskId: task.id });
    expect(events).toHaveLength(3);
    expect(events[0].message).toBe('First');
    expect(events[1].message).toBe('Second');
    expect(events[2].message).toBe('Third');

    // Timestamps should be non-decreasing
    for (let i = 1; i < events.length; i++) {
      expect(events[i].createdAt).toBeGreaterThanOrEqual(events[i - 1].createdAt);
    }
  });

  it('should log activity entries', () => {
    const project = ctx.projectStore.createProject(createProjectInput());

    ctx.activityLog.log({
      action: 'create',
      entityType: 'project',
      entityId: project.id,
      summary: `Created project "${project.name}"`,
      data: { projectName: project.name },
    });

    const entries = ctx.activityLog.getEntries({ entityType: 'project', entityId: project.id });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('create');
    expect(entries[0].summary).toContain(project.name);
  });

  it('should filter activity entries by action', () => {
    const project = ctx.projectStore.createProject(createProjectInput());

    ctx.activityLog.log({
      action: 'create',
      entityType: 'project',
      entityId: project.id,
      summary: 'Created project',
    });
    ctx.activityLog.log({
      action: 'update',
      entityType: 'project',
      entityId: project.id,
      summary: 'Updated project',
    });

    const creates = ctx.activityLog.getEntries({ action: 'create' });
    expect(creates).toHaveLength(1);
    expect(creates[0].summary).toBe('Created project');

    const updates = ctx.activityLog.getEntries({ action: 'update' });
    expect(updates).toHaveLength(1);
    expect(updates[0].summary).toBe('Updated project');
  });

  it('should return activity entries in chronological order', () => {
    ctx.activityLog.log({ action: 'create', entityType: 'system', entityId: '1', summary: 'First' });
    ctx.activityLog.log({ action: 'create', entityType: 'system', entityId: '2', summary: 'Second' });
    ctx.activityLog.log({ action: 'create', entityType: 'system', entityId: '3', summary: 'Third' });

    const entries = ctx.activityLog.getEntries({ entityType: 'system' });
    expect(entries).toHaveLength(3);
    expect(entries[0].summary).toBe('First');
    expect(entries[1].summary).toBe('Second');
    expect(entries[2].summary).toBe('Third');
  });
});
