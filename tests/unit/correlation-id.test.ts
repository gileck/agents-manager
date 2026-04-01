import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestContext, type TestContext, applyMigrations } from '../helpers/test-context';
import { createProjectInput, createTaskInput } from '../helpers/factories';
import { resetCounters } from '../helpers/factories';
import { AGENT_PIPELINE } from '../../src/core/data/seeded-pipelines';
import { SqliteTaskEventLog } from '../../src/core/stores/sqlite-task-event-log';
import { SqliteTimelineStore } from '../../src/core/stores/sqlite-timeline-store';
import { TimelineService } from '../../src/core/services/timeline/timeline-service';
import { EventSource } from '../../src/core/services/timeline/sources/event-source';
import { TransitionSource } from '../../src/core/services/timeline/sources/transition-source';
import { AgentRunSource } from '../../src/core/services/timeline/sources/agent-run-source';
import { ErrorAggregationService } from '../../src/core/services/error-aggregation-service';
import type { HookResult } from '../../src/shared/types';

const PIPELINE_ID = AGENT_PIPELINE.id;

describe('Correlation ID propagation', () => {
  let ctx: TestContext;
  let projectId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    // Register a stub start_agent hook so transitions with that hook succeed
    ctx.pipelineEngine.registerHook('start_agent', async (): Promise<HookResult> => {
      return { success: true };
    });
    const project = await ctx.projectStore.createProject(createProjectInput());
    projectId = project.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('PipelineEngine.executeTransition', () => {
    it('should auto-generate a correlationId for transitions', async () => {
      const task = await ctx.taskStore.createTask(createTaskInput(projectId, PIPELINE_ID));

      // Execute a manual transition (backlog → investigating)
      const result = await ctx.pipelineEngine.executeTransition(task, 'investigating', { trigger: 'manual' });
      expect(result.success).toBe(true);

      // Check the transition_history record has a correlation_id
      const rows = ctx.db.prepare(
        'SELECT correlation_id FROM transition_history WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
      ).all(task.id) as { correlation_id: string | null }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].correlation_id).toBeTruthy();
      expect(typeof rows[0].correlation_id).toBe('string');
    });

    it('should use provided correlationId when given', async () => {
      const task = await ctx.taskStore.createTask(createTaskInput(projectId, PIPELINE_ID));
      const customId = 'test-correlation-123';

      const result = await ctx.pipelineEngine.executeTransition(task, 'investigating', {
        trigger: 'manual',
        correlationId: customId,
      });
      expect(result.success).toBe(true);

      const rows = ctx.db.prepare(
        'SELECT correlation_id FROM transition_history WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
      ).all(task.id) as { correlation_id: string | null }[];
      expect(rows[0].correlation_id).toBe(customId);
    });

    it('should not mutate the caller context object', async () => {
      const task = await ctx.taskStore.createTask(createTaskInput(projectId, PIPELINE_ID));
      const context = { trigger: 'manual' as const };

      await ctx.pipelineEngine.executeTransition(task, 'investigating', context);

      // The caller's context should not be mutated
      expect(context).toEqual({ trigger: 'manual' });
      expect((context as Record<string, unknown>).correlationId).toBeUndefined();
    });

    it('should propagate correlationId into status_change events', async () => {
      const task = await ctx.taskStore.createTask(createTaskInput(projectId, PIPELINE_ID));
      const customId = 'corr-status-change';

      await ctx.pipelineEngine.executeTransition(task, 'investigating', {
        trigger: 'manual',
        correlationId: customId,
      });

      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'status_change' });
      expect(events.length).toBeGreaterThanOrEqual(1);
      const statusEvent = events.find((e) => e.message.includes('investigating'));
      expect(statusEvent).toBeDefined();
      expect(statusEvent!.correlationId).toBe(customId);
    });
  });

  describe('PipelineEngine.executeForceTransition', () => {
    it('should auto-generate correlationId for force transitions', async () => {
      const task = await ctx.taskStore.createTask(createTaskInput(projectId, PIPELINE_ID));

      const result = await ctx.pipelineEngine.executeForceTransition(task, 'investigating');
      expect(result.success).toBe(true);

      // Check the transition_history record
      const rows = ctx.db.prepare(
        'SELECT correlation_id FROM transition_history WHERE task_id = ? ORDER BY created_at DESC LIMIT 1',
      ).all(task.id) as { correlation_id: string | null }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].correlation_id).toBeTruthy();
    });

    it('should propagate correlationId into force-transition status_change events', async () => {
      const task = await ctx.taskStore.createTask(createTaskInput(projectId, PIPELINE_ID));
      const customId = 'corr-force';

      await ctx.pipelineEngine.executeForceTransition(task, 'investigating', {
        trigger: 'manual',
        correlationId: customId,
      });

      const events = await ctx.taskEventLog.getEvents({ taskId: task.id, category: 'status_change' });
      const forceEvent = events.find((e) => e.message.includes('Force-transitioned'));
      expect(forceEvent).toBeDefined();
      expect(forceEvent!.correlationId).toBe(customId);
    });
  });
});

describe('SqliteTaskEventLog correlationId', () => {
  let db: Database.Database;
  let store: SqliteTaskEventLog;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    db.pragma('foreign_keys = ON');
    store = new SqliteTaskEventLog(db);

    // Insert a project and task to satisfy FK constraints
    db.prepare("INSERT INTO projects (id, name, description, config, created_at, updated_at) VALUES ('proj-1', 'P', 'D', '{}', 1, 1)").run();
    db.prepare("INSERT INTO pipelines (id, name, description, statuses, transitions, task_type, created_at, updated_at) VALUES ('pip-1', 'P', 'D', '[]', '[]', 'test-corr', 1, 1)").run();
    db.prepare("INSERT INTO tasks (id, project_id, pipeline_id, title, description, status, created_at, updated_at) VALUES ('task-1', 'proj-1', 'pip-1', 'T', 'D', 'backlog', 1, 1)").run();
  });

  afterEach(() => {
    db.close();
  });

  it('should store and return correlationId', async () => {
    const event = await store.log({
      taskId: 'task-1',
      category: 'system',
      severity: 'error',
      message: 'Test error',
      correlationId: 'corr-abc',
    });

    expect(event.correlationId).toBe('corr-abc');
  });

  it('should filter events by correlationId', async () => {
    await store.log({ taskId: 'task-1', category: 'system', severity: 'error', message: 'Error A', correlationId: 'corr-1' });
    await store.log({ taskId: 'task-1', category: 'system', severity: 'error', message: 'Error B', correlationId: 'corr-2' });
    await store.log({ taskId: 'task-1', category: 'system', severity: 'info', message: 'Info C', correlationId: 'corr-1' });

    const filtered = await store.getEvents({ taskId: 'task-1', correlationId: 'corr-1' });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.correlationId === 'corr-1')).toBe(true);
  });

  it('should return events without correlationId when none is set', async () => {
    const event = await store.log({
      taskId: 'task-1',
      category: 'system',
      severity: 'info',
      message: 'No correlation',
    });

    expect(event.correlationId).toBeUndefined();
  });
});

describe('ErrorAggregationService', () => {
  let db: Database.Database;
  let timelineService: TimelineService;
  let errorService: ErrorAggregationService;
  let taskEventLog: SqliteTaskEventLog;

  beforeEach(() => {
    db = new Database(':memory:');
    applyMigrations(db);
    db.pragma('foreign_keys = ON');

    // Insert required parent records
    db.prepare("INSERT INTO projects (id, name, description, config, created_at, updated_at) VALUES ('proj-1', 'P', 'D', '{}', 1, 1)").run();
    db.prepare("INSERT INTO pipelines (id, name, description, statuses, transitions, task_type, created_at, updated_at) VALUES ('pip-1', 'P', 'D', '[]', '[]', 'test-err-agg', 1, 1)").run();
    db.prepare("INSERT INTO tasks (id, project_id, pipeline_id, title, description, status, created_at, updated_at) VALUES ('task-1', 'proj-1', 'pip-1', 'T', 'D', 'backlog', 1, 1)").run();

    taskEventLog = new SqliteTaskEventLog(db);
    const timelineStore = new SqliteTimelineStore(db);
    timelineService = new TimelineService([
      new EventSource(timelineStore),
      new TransitionSource(timelineStore),
      new AgentRunSource(timelineStore),
    ]);
    errorService = new ErrorAggregationService(timelineService);
  });

  afterEach(() => {
    db.close();
  });

  it('should return only error-severity entries', async () => {
    await taskEventLog.log({ taskId: 'task-1', category: 'system', severity: 'error', message: 'Error 1' });
    await taskEventLog.log({ taskId: 'task-1', category: 'system', severity: 'info', message: 'Info 1' });
    await taskEventLog.log({ taskId: 'task-1', category: 'system', severity: 'error', message: 'Error 2' });

    const errors = errorService.getErrors({ taskId: 'task-1' });
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.severity === 'error')).toBe(true);
  });

  it('should filter errors by correlationId', async () => {
    await taskEventLog.log({ taskId: 'task-1', category: 'system', severity: 'error', message: 'Err A', correlationId: 'corr-1' });
    await taskEventLog.log({ taskId: 'task-1', category: 'system', severity: 'error', message: 'Err B', correlationId: 'corr-2' });
    await taskEventLog.log({ taskId: 'task-1', category: 'system', severity: 'error', message: 'Err C', correlationId: 'corr-1' });

    const errors = errorService.getErrors({ taskId: 'task-1', correlationId: 'corr-1' });
    expect(errors).toHaveLength(2);
    expect(errors.every((e) => e.correlationId === 'corr-1')).toBe(true);
  });

  it('should return empty array when no taskId provided', () => {
    const errors = errorService.getErrors({});
    expect(errors).toEqual([]);
  });

  it('should group entries by correlationId', async () => {
    await taskEventLog.log({ taskId: 'task-1', category: 'system', severity: 'info', message: 'A', correlationId: 'corr-1' });
    await taskEventLog.log({ taskId: 'task-1', category: 'system', severity: 'error', message: 'B', correlationId: 'corr-1' });
    await taskEventLog.log({ taskId: 'task-1', category: 'system', severity: 'info', message: 'C', correlationId: 'corr-2' });
    await taskEventLog.log({ taskId: 'task-1', category: 'system', severity: 'info', message: 'D' }); // no correlationId

    const groups = errorService.getCorrelationGroups('task-1');
    expect(Object.keys(groups)).toHaveLength(2);
    expect(groups['corr-1']).toHaveLength(2);
    expect(groups['corr-2']).toHaveLength(1);
    // Entry without correlationId should not appear in groups
    expect(Object.values(groups).flat()).toHaveLength(3);
  });
});
