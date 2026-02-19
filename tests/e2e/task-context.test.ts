import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { createProjectInput, createTaskInput, createTaskContextInput, resetCounters } from '../helpers/factories';

describe('Task Context', () => {
  let ctx: TestContext;
  let taskId: string;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();

    const project = await ctx.projectStore.createProject(createProjectInput());
    const task = await ctx.taskStore.createTask(createTaskInput(project.id, 'pipeline-simple'));
    taskId = task.id;
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should add a context entry with all fields', async () => {
    const entry = await ctx.taskContextStore.addEntry(
      createTaskContextInput(taskId, {
        source: 'user',
        entryType: 'requirement',
        summary: 'Must support dark mode',
        data: { priority: 'high' },
      }),
    );

    expect(entry.id).toBeDefined();
    expect(entry.taskId).toBe(taskId);
    expect(entry.source).toBe('user');
    expect(entry.entryType).toBe('requirement');
    expect(entry.summary).toBe('Must support dark mode');
    expect(entry.data).toEqual({ priority: 'high' });
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(entry.agentRunId).toBeNull();
  });

  it('should add an entry with default data', async () => {
    const entry = await ctx.taskContextStore.addEntry(
      createTaskContextInput(taskId),
    );

    expect(entry.data).toEqual({});
  });

  it('should add an entry with optional agentRunId', async () => {
    const run = await ctx.agentRunStore.createRun({
      taskId,
      agentType: 'scripted',
      mode: 'plan',
    });

    const entry = await ctx.taskContextStore.addEntry(
      createTaskContextInput(taskId, { agentRunId: run.id }),
    );

    expect(entry.agentRunId).toBe(run.id);
  });

  it('should get entries for a task in chronological order', async () => {
    await ctx.taskContextStore.addEntry(
      createTaskContextInput(taskId, { summary: 'First entry' }),
    );
    await ctx.taskContextStore.addEntry(
      createTaskContextInput(taskId, { summary: 'Second entry' }),
    );

    const entries = await ctx.taskContextStore.getEntriesForTask(taskId);

    expect(entries).toHaveLength(2);
    expect(entries[0].summary).toBe('First entry');
    expect(entries[1].summary).toBe('Second entry');
    expect(entries[0].createdAt).toBeLessThanOrEqual(entries[1].createdAt);
  });

  it('should return empty array for task with no entries', async () => {
    const entries = await ctx.taskContextStore.getEntriesForTask(taskId);
    expect(entries).toEqual([]);
  });

  it('should handle multiple entries from different sources', async () => {
    await ctx.taskContextStore.addEntry(
      createTaskContextInput(taskId, { source: 'user', summary: 'User input' }),
    );
    await ctx.taskContextStore.addEntry(
      createTaskContextInput(taskId, { source: 'agent', summary: 'Agent observation' }),
    );
    await ctx.taskContextStore.addEntry(
      createTaskContextInput(taskId, { source: 'system', summary: 'System event' }),
    );

    const entries = await ctx.taskContextStore.getEntriesForTask(taskId);

    expect(entries).toHaveLength(3);
    const sources = entries.map(e => e.source);
    expect(sources).toContain('user');
    expect(sources).toContain('agent');
    expect(sources).toContain('system');
  });
});
