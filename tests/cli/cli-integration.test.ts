import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestContext, type TestContext } from '../helpers/test-context';
import { SEEDED_PIPELINES } from '../../src/core/data/seeded-pipelines';
import { resolveProject, requireProject, resolveTaskId } from '../../src/cli/context';
import { output } from '../../src/cli/output';

describe('CLI Integration', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('Project CRUD', () => {
    it('should create, list, get, update, and delete projects', async () => {
      // Create
      const project = await ctx.projectStore.createProject({
        name: 'Test Project',
        description: 'A test project',
        path: '/tmp/test-project',
      });
      expect(project.name).toBe('Test Project');
      expect(project.path).toBe('/tmp/test-project');

      // List
      const projects = await ctx.projectStore.listProjects();
      expect(projects.length).toBe(1);
      expect(projects[0].id).toBe(project.id);

      // Get
      const fetched = await ctx.projectStore.getProject(project.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('Test Project');

      // Update
      const updated = await ctx.projectStore.updateProject(project.id, {
        name: 'Updated Project',
      });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe('Updated Project');

      // Delete
      const deleted = await ctx.projectStore.deleteProject(project.id);
      expect(deleted).toBe(true);

      const afterDelete = await ctx.projectStore.listProjects();
      expect(afterDelete.length).toBe(0);
    });
  });

  describe('Task CRUD + Transitions', () => {
    it('should create task, list with filters, and transition', async () => {
      // Setup project
      const project = await ctx.projectStore.createProject({
        name: 'Task Test Project',
        path: '/tmp/task-test',
      });

      // Get first pipeline
      const pipelines = await ctx.pipelineStore.listPipelines();
      expect(pipelines.length).toBeGreaterThan(0);
      const pipeline = pipelines[0];

      // Create task via workflowService (logs activity)
      const task = await ctx.workflowService.createTask({
        projectId: project.id,
        pipelineId: pipeline.id,
        title: 'Fix the bug',
        priority: 2,
        assignee: 'alice',
      });
      expect(task.title).toBe('Fix the bug');
      expect(task.status).toBe(pipeline.statuses[0].name);

      // List with filter
      const filtered = await ctx.taskStore.listTasks({
        projectId: project.id,
        assignee: 'alice',
      });
      expect(filtered.length).toBe(1);

      // Get valid transitions
      const transitions = await ctx.pipelineEngine.getValidTransitions(task, 'manual');
      expect(transitions.length).toBeGreaterThan(0);

      // Transition task
      const result = await ctx.workflowService.transitionTask(
        task.id,
        transitions[0].to,
      );
      expect(result.success).toBe(true);
      expect(result.task!.status).toBe(transitions[0].to);

      // Verify event history logged
      const events = await ctx.taskEventLog.getEvents({ taskId: task.id });
      expect(events.length).toBeGreaterThan(0);
    });

    it('should delete task via workflowService', async () => {
      const project = await ctx.projectStore.createProject({ name: 'Del Test' });
      const pipelines = await ctx.pipelineStore.listPipelines();
      const task = await ctx.workflowService.createTask({
        projectId: project.id,
        pipelineId: pipelines[0].id,
        title: 'To be deleted',
      });

      const deleted = await ctx.workflowService.deleteTask(task.id);
      expect(deleted).toBe(true);

      const fetched = await ctx.taskStore.getTask(task.id);
      expect(fetched).toBeNull();
    });
  });

  describe('Agent start/stop', () => {
    it('should start agent and verify run', async () => {
      const project = await ctx.projectStore.createProject({
        name: 'Agent Test',
        path: '/tmp/agent-test',
      });
      const pipelines = await ctx.pipelineStore.listPipelines();
      const task = await ctx.workflowService.createTask({
        projectId: project.id,
        pipelineId: pipelines[0].id,
        title: 'Agent task',
      });

      // Transition to in_progress first
      const transitions = await ctx.pipelineEngine.getValidTransitions(task, 'manual');
      if (transitions.length > 0) {
        await ctx.workflowService.transitionTask(task.id, transitions[0].to);
      }

      const run = await ctx.workflowService.startAgent(task.id, 'plan', 'scripted');
      expect(run.taskId).toBe(task.id);
      expect(run.agentType).toBe('scripted');
      expect(run.mode).toBe('plan');
      expect(['completed', 'failed', 'running']).toContain(run.status);

      // Wait for background execution to complete before cleanup
      await ctx.agentService.waitForCompletion(run.id);

      // Verify run is recorded
      const runs = await ctx.agentRunStore.getRunsForTask(task.id);
      expect(runs.length).toBeGreaterThan(0);
    });
  });

  describe('Project auto-detection', () => {
    function mockApiFromCtx() {
      return {
        projects: {
          list: () => ctx.projectStore.listProjects(),
          get: (id: string) => ctx.projectStore.getProject(id).then((p) => {
            if (!p) throw new Error('Not found');
            return p;
          }),
        },
      } as Parameters<typeof resolveProject>[0];
    }

    it('should resolve project from explicit ID', async () => {
      const project = await ctx.projectStore.createProject({
        name: 'Resolve Test',
        path: '/tmp/resolve-test',
      });

      const resolved = await resolveProject(mockApiFromCtx(), project.id);
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(project.id);
    });

    it('should throw for missing project ID', async () => {
      await expect(
        resolveProject(mockApiFromCtx(), 'nonexistent'),
      ).rejects.toThrow('Project not found');
    });

    it('should return null when no project matches', async () => {
      const resolved = await resolveProject(mockApiFromCtx());
      expect(resolved).toBeNull();
    });

    it('requireProject should throw with project list when no match', async () => {
      const _project = await ctx.projectStore.createProject({
        name: 'Listed Project',
        path: '/tmp/listed',
      });

      await expect(
        requireProject(mockApiFromCtx()),
      ).rejects.toThrow('No project detected');
    });
  });

  describe('resolveTaskId', () => {
    function makeTaskApi(taskIds: string[]) {
      return {
        tasks: {
          list: vi.fn().mockResolvedValue(taskIds.map((id) => ({ id }))),
        },
      } as unknown as Parameters<typeof resolveTaskId>[0];
    }

    it('returns a full UUID immediately without calling the API', async () => {
      const fullId = 'abcdef12-1234-1234-1234-abcdef123456';
      const api = makeTaskApi([]);
      const result = await resolveTaskId(api, fullId);
      expect(result).toBe(fullId);
      expect(api.tasks.list).not.toHaveBeenCalled();
    });

    it('resolves a single prefix match and writes resolved message to stderr', async () => {
      const fullId = 'abcdef12-1234-1234-1234-abcdef123456';
      const api = makeTaskApi([fullId]);
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      try {
        const result = await resolveTaskId(api, 'abcdef12');
        expect(result).toBe(fullId);
        expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('abcdef12'));
        expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining(fullId));
      } finally {
        stderrSpy.mockRestore();
      }
    });

    it('throws an ambiguous error when multiple tasks share the same first segment', async () => {
      const api = makeTaskApi([
        'abcdef12-1111-1111-1111-111111111111',
        'abcdef12-2222-2222-2222-222222222222',
      ]);
      await expect(resolveTaskId(api, 'abcdef12')).rejects.toThrow('Ambiguous ID, 2 matches found');
    });

    it('throws a not-found error when no task matches the prefix', async () => {
      const api = makeTaskApi(['deadbeef-1234-1234-1234-deadbeef1234']);
      await expect(resolveTaskId(api, 'aaaaaaaa')).rejects.toThrow('Task not found: aaaaaaaa');
    });
  });

  describe('Output formatting', () => {
    it('JSON mode returns parseable JSON', () => {
      const data = [{ id: '1', name: 'Test' }];
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      output(data, { json: true });

      console.log = origLog;
      const parsed = JSON.parse(logs[0]);
      expect(parsed).toEqual(data);
    });

    it('quiet mode returns IDs only', () => {
      const data = [
        { id: 'abc', name: 'One' },
        { id: 'def', name: 'Two' },
      ];
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      output(data, { quiet: true });

      console.log = origLog;
      expect(logs).toEqual(['abc', 'def']);
    });

    it('default mode prints table', () => {
      const data = [{ id: '1', name: 'Hello' }];
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      output(data, {});

      console.log = origLog;
      expect(logs.length).toBeGreaterThanOrEqual(3); // header + separator + row
      expect(logs[0]).toContain('ID');
      expect(logs[0]).toContain('NAME');
    });

    it('empty array prints no results', () => {
      const logs: string[] = [];
      const origLog = console.log;
      console.log = (...args: unknown[]) => logs.push(args.join(' '));

      output([], {});

      console.log = origLog;
      expect(logs[0]).toBe('No results.');
    });
  });

  describe('Dependencies', () => {
    it('should add and list dependencies', async () => {
      const project = await ctx.projectStore.createProject({ name: 'Dep Test' });
      const pipelines = await ctx.pipelineStore.listPipelines();
      const task1 = await ctx.workflowService.createTask({
        projectId: project.id,
        pipelineId: pipelines[0].id,
        title: 'Task 1',
      });
      const task2 = await ctx.workflowService.createTask({
        projectId: project.id,
        pipelineId: pipelines[0].id,
        title: 'Task 2',
      });

      await ctx.taskStore.addDependency(task1.id, task2.id);

      const deps = await ctx.taskStore.getDependencies(task1.id);
      expect(deps.length).toBe(1);
      expect(deps[0].id).toBe(task2.id);

      await ctx.taskStore.removeDependency(task1.id, task2.id);
      const afterRemove = await ctx.taskStore.getDependencies(task1.id);
      expect(afterRemove.length).toBe(0);
    });
  });

  describe('Pipelines', () => {
    it('should list seeded pipelines', async () => {
      const pipelines = await ctx.pipelineStore.listPipelines();
      expect(pipelines.length).toBe(SEEDED_PIPELINES.length);
    });

    it('should get pipeline details', async () => {
      const pipelines = await ctx.pipelineStore.listPipelines();
      const pipeline = await ctx.pipelineStore.getPipeline(pipelines[0].id);
      expect(pipeline).not.toBeNull();
      expect(pipeline!.statuses.length).toBeGreaterThan(0);
      expect(pipeline!.transitions.length).toBeGreaterThan(0);
    });
  });

  describe('Events', () => {
    it('should list events for a task', async () => {
      const project = await ctx.projectStore.createProject({ name: 'Event Test' });
      const pipelines = await ctx.pipelineStore.listPipelines();
      const task = await ctx.workflowService.createTask({
        projectId: project.id,
        pipelineId: pipelines[0].id,
        title: 'Event task',
      });

      // Transition to generate events
      const transitions = await ctx.pipelineEngine.getValidTransitions(task, 'manual');
      if (transitions.length > 0) {
        await ctx.workflowService.transitionTask(task.id, transitions[0].to);
      }

      const events = await ctx.taskEventLog.getEvents({ taskId: task.id });
      expect(events.length).toBeGreaterThan(0);
    });
  });
});
