import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentSupervisor } from '../../src/core/services/agent-supervisor';
import type { IAgentRunStore } from '../../src/core/interfaces/agent-run-store';
import type { IAgentService } from '../../src/core/interfaces/agent-service';
import type { ITaskEventLog } from '../../src/core/interfaces/task-event-log';
import type { ITaskStore } from '../../src/core/interfaces/task-store';
import type { IPipelineStore } from '../../src/core/interfaces/pipeline-store';
import type { IWorkflowService } from '../../src/core/interfaces/workflow-service';
import type { AgentRun, Task, Pipeline } from '../../src/shared/types';

// Mock the `now()` utility so we can control time
vi.mock('../../src/core/stores/utils', () => ({
  now: vi.fn(() => Date.now()),
}));

import { now } from '../../src/core/stores/utils';
const mockedNow = vi.mocked(now);

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    taskId: 'task-1',
    agentType: 'implementor',
    mode: 'new',
    status: 'running',
    output: null,
    outcome: null,
    payload: {},
    exitCode: null,
    startedAt: 1000,
    completedAt: null,
    costInputTokens: null,
    costOutputTokens: null,
    prompt: null,
    error: null,
    timeoutMs: null,
    maxTurns: null,
    messageCount: null,
    messages: null,
    ...overrides,
  };
}

describe('AgentSupervisor', () => {
  let agentRunStore: {
    getActiveRuns: ReturnType<typeof vi.fn>;
    updateRun: ReturnType<typeof vi.fn>;
    createRun: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
    getRunsForTask: ReturnType<typeof vi.fn>;
    getAllRuns: ReturnType<typeof vi.fn>;
  };
  let agentService: {
    execute: ReturnType<typeof vi.fn>;
    queueMessage: ReturnType<typeof vi.fn>;
    waitForCompletion: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    recoverOrphanedRuns: ReturnType<typeof vi.fn>;
    getActiveRunIds: ReturnType<typeof vi.fn>;
  };
  let taskEventLog: {
    log: ReturnType<typeof vi.fn>;
    getEvents: ReturnType<typeof vi.fn>;
  };
  let supervisor: AgentSupervisor;

  beforeEach(() => {
    vi.useFakeTimers();

    agentRunStore = {
      getActiveRuns: vi.fn().mockResolvedValue([]),
      updateRun: vi.fn().mockResolvedValue(null),
      createRun: vi.fn(),
      getRun: vi.fn(),
      getRunsForTask: vi.fn(),
      getAllRuns: vi.fn(),
    };

    agentService = {
      execute: vi.fn(),
      queueMessage: vi.fn(),
      waitForCompletion: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      recoverOrphanedRuns: vi.fn(),
      getActiveRunIds: vi.fn().mockReturnValue([]),
    };

    taskEventLog = {
      log: vi.fn().mockResolvedValue({ id: 'evt-1', taskId: 'task-1', category: 'agent', severity: 'warning', message: '', data: {}, createdAt: Date.now() }),
      getEvents: vi.fn(),
    };

    // Use a short poll interval and timeout for tests
    supervisor = new AgentSupervisor(
      agentRunStore as unknown as IAgentRunStore,
      agentService as unknown as IAgentService,
      taskEventLog as unknown as ITaskEventLog,
      1000,   // pollIntervalMs
      5000,   // defaultTimeoutMs
    );
  });

  afterEach(() => {
    supervisor.stop();
    vi.useRealTimers();
  });

  describe('timeout detection', () => {
    it('marks a run as timed_out when elapsed exceeds defaultTimeoutMs + grace period', async () => {
      const longRun = makeRun({ id: 'timeout-1', taskId: 'task-2', startedAt: 1000 });
      agentRunStore.getActiveRuns.mockResolvedValue([longRun]);
      // defaultTimeoutMs=5000 + 5min grace=300000 → effective=305000; elapsed=306000 > 305000
      mockedNow.mockReturnValue(307000);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(agentService.stop).toHaveBeenCalledWith('timeout-1');

      expect(agentRunStore.updateRun).toHaveBeenCalledWith('timeout-1', expect.objectContaining({
        status: 'timed_out',
      }));

      expect(taskEventLog.log).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-2',
        severity: 'warning',
        message: expect.stringContaining('timed out'),
      }));
    });

    it('does not mark a run as timed_out if elapsed is within timeout + grace', async () => {
      const recentRun = makeRun({ id: 'ok-1', startedAt: 1000 });
      agentRunStore.getActiveRuns.mockResolvedValue([recentRun]);
      mockedNow.mockReturnValue(3000); // elapsed = 2000 < 305000 (5000 + 300000)

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(agentRunStore.updateRun).not.toHaveBeenCalled();
      expect(agentService.stop).not.toHaveBeenCalled();
    });

    it('handles agentService.stop() throwing when agent already completed', async () => {
      const longRun = makeRun({ id: 'timeout-err', startedAt: 0 });
      agentRunStore.getActiveRuns.mockResolvedValue([longRun]);
      agentService.stop.mockRejectedValue(new Error('agent already done'));
      // Must exceed defaultTimeoutMs(5000) + grace(300000) = 305000
      mockedNow.mockReturnValue(310000);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      // Should still mark as timed_out despite the stop error
      expect(agentRunStore.updateRun).toHaveBeenCalledWith('timeout-err', expect.objectContaining({
        status: 'timed_out',
      }));
    });

    it('uses per-run timeoutMs when set in the run record', async () => {
      // run.timeoutMs = 2000, grace = 300000. Effective = 302000
      const longRun = makeRun({ id: 'per-run-1', taskId: 'task-3', startedAt: 1000, timeoutMs: 2000 });
      agentRunStore.getActiveRuns.mockResolvedValue([longRun]);
      // elapsed = 303001 > 302000
      mockedNow.mockReturnValue(303002);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(agentService.stop).toHaveBeenCalledWith('per-run-1');
      expect(agentRunStore.updateRun).toHaveBeenCalledWith('per-run-1', expect.objectContaining({
        status: 'timed_out',
      }));
    });

    it('does not time out when elapsed is within per-run timeoutMs + grace', async () => {
      // run.timeoutMs = 2000, grace = 300000. Effective = 302000
      const run = makeRun({ id: 'per-run-ok', startedAt: 1000, timeoutMs: 2000 });
      agentRunStore.getActiveRuns.mockResolvedValue([run]);
      // elapsed = 4000 < 302000
      mockedNow.mockReturnValue(5000);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(agentRunStore.updateRun).not.toHaveBeenCalled();
      expect(agentService.stop).not.toHaveBeenCalled();
    });
  });

  describe('polling lifecycle', () => {
    it('start() begins polling and stop() ends it', async () => {
      agentRunStore.getActiveRuns.mockResolvedValue([]);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(3000);

      expect(agentRunStore.getActiveRuns).toHaveBeenCalledTimes(3);

      supervisor.stop();
      agentRunStore.getActiveRuns.mockClear();

      await vi.advanceTimersByTimeAsync(3000);
      expect(agentRunStore.getActiveRuns).not.toHaveBeenCalled();
    });

    it('start() is idempotent - calling twice does not create two timers', async () => {
      agentRunStore.getActiveRuns.mockResolvedValue([]);

      supervisor.start();
      supervisor.start(); // second call should be ignored

      await vi.advanceTimersByTimeAsync(1000);
      // Only one poll should have fired (not two)
      expect(agentRunStore.getActiveRuns).toHaveBeenCalledTimes(1);
    });

    it('stop() without start() does not throw', () => {
      expect(() => supervisor.stop()).not.toThrow();
    });
  });

  describe('no active runs', () => {
    it('does nothing when getActiveRuns returns empty array', async () => {
      agentRunStore.getActiveRuns.mockResolvedValue([]);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(agentRunStore.updateRun).not.toHaveBeenCalled();
      expect(agentService.stop).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('poll errors are caught and do not stop polling', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      agentRunStore.getActiveRuns.mockRejectedValueOnce(new Error('DB down'));
      agentRunStore.getActiveRuns.mockResolvedValue([]);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(2000);

      // Should have attempted a second poll after the first one failed
      expect(agentRunStore.getActiveRuns).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });
  });
});

// ========================================
// Stall detection tests
// ========================================

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-stall-1',
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: 'Stalled task',
    description: null,
    debugInfo: null,
    status: 'implementing',
    priority: 1,
    tags: [],
    parentTaskId: null,
    featureId: null,
    assignee: null,
    prLink: null,
    branchName: null,
    plan: null,
    technicalDesign: null,
    subtasks: [],
    phases: null,
    planComments: [],
    technicalDesignComments: [],
    metadata: {},
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pipe-1',
    name: 'Test Pipeline',
    description: null,
    taskType: 'feature',
    statuses: [
      { name: 'open', label: 'Open', category: 'ready' },
      { name: 'implementing', label: 'Implementing', category: 'agent_running' },
      { name: 'done', label: 'Done', category: 'terminal', isFinal: true },
    ],
    transitions: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('AgentSupervisor — stall detection', () => {
  let agentRunStore: {
    getActiveRuns: ReturnType<typeof vi.fn>;
    updateRun: ReturnType<typeof vi.fn>;
    createRun: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
    getRunsForTask: ReturnType<typeof vi.fn>;
    getAllRuns: ReturnType<typeof vi.fn>;
  };
  let agentService: {
    execute: ReturnType<typeof vi.fn>;
    queueMessage: ReturnType<typeof vi.fn>;
    waitForCompletion: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    recoverOrphanedRuns: ReturnType<typeof vi.fn>;
    getActiveRunIds: ReturnType<typeof vi.fn>;
  };
  let taskEventLog: {
    log: ReturnType<typeof vi.fn>;
    getEvents: ReturnType<typeof vi.fn>;
  };
  let taskStore: {
    getTask: ReturnType<typeof vi.fn>;
    listTasks: ReturnType<typeof vi.fn>;
    createTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
    deleteTask: ReturnType<typeof vi.fn>;
    resetTask: ReturnType<typeof vi.fn>;
    addDependency: ReturnType<typeof vi.fn>;
    removeDependency: ReturnType<typeof vi.fn>;
    getDependencies: ReturnType<typeof vi.fn>;
    getDependents: ReturnType<typeof vi.fn>;
    getStatusCounts: ReturnType<typeof vi.fn>;
    getTotalCount: ReturnType<typeof vi.fn>;
  };
  let pipelineStore: {
    getPipeline: ReturnType<typeof vi.fn>;
    listPipelines: ReturnType<typeof vi.fn>;
    createPipeline: ReturnType<typeof vi.fn>;
    updatePipeline: ReturnType<typeof vi.fn>;
    deletePipeline: ReturnType<typeof vi.fn>;
    getPipelineForTaskType: ReturnType<typeof vi.fn>;
  };
  let workflowService: {
    startAgent: ReturnType<typeof vi.fn>;
  };
  let supervisor: AgentSupervisor;

  beforeEach(() => {
    vi.useFakeTimers();

    agentRunStore = {
      getActiveRuns: vi.fn().mockResolvedValue([]),
      updateRun: vi.fn().mockResolvedValue(null),
      createRun: vi.fn(),
      getRun: vi.fn(),
      getRunsForTask: vi.fn().mockResolvedValue([]),
      getAllRuns: vi.fn(),
    };

    agentService = {
      execute: vi.fn(),
      queueMessage: vi.fn(),
      waitForCompletion: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      recoverOrphanedRuns: vi.fn(),
      getActiveRunIds: vi.fn().mockReturnValue([]),
    };

    taskEventLog = {
      log: vi.fn().mockResolvedValue({ id: 'evt-1', taskId: 'task-1', category: 'system', severity: 'warning', message: '', data: {}, createdAt: Date.now() }),
      getEvents: vi.fn(),
    };

    taskStore = {
      getTask: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      resetTask: vi.fn(),
      addDependency: vi.fn(),
      removeDependency: vi.fn(),
      getDependencies: vi.fn(),
      getDependents: vi.fn(),
      getStatusCounts: vi.fn(),
      getTotalCount: vi.fn(),
    };

    pipelineStore = {
      getPipeline: vi.fn(),
      listPipelines: vi.fn().mockResolvedValue([]),
      createPipeline: vi.fn(),
      updatePipeline: vi.fn(),
      deletePipeline: vi.fn(),
      getPipelineForTaskType: vi.fn(),
    };

    workflowService = {
      startAgent: vi.fn().mockResolvedValue(makeRun()),
    };

    supervisor = new AgentSupervisor(
      agentRunStore as unknown as IAgentRunStore,
      agentService as unknown as IAgentService,
      taskEventLog as unknown as ITaskEventLog,
      1000,   // pollIntervalMs
      5000,   // defaultTimeoutMs
      taskStore as unknown as ITaskStore,
      pipelineStore as unknown as IPipelineStore,
      workflowService as unknown as IWorkflowService,
    );
  });

  afterEach(() => {
    supervisor.stop();
    vi.useRealTimers();
  });

  it('calls workflowService.startAgent with correct agentType from latest run for a stalled task', async () => {
    const pipeline = makePipeline();
    pipelineStore.listPipelines.mockResolvedValue([pipeline]);

    const task = makeTask({ updatedAt: 1000 }); // updated long ago
    taskStore.listTasks.mockResolvedValue([task]);

    // Previous run exists with agentType 'implementor'
    const previousRun = makeRun({ id: 'run-prev', status: 'completed', completedAt: 1000, agentType: 'implementor', mode: 'new' });
    agentRunStore.getRunsForTask.mockResolvedValue([previousRun]);

    // now() > task.updatedAt + 60s grace AND > completedAt + 60s grace
    mockedNow.mockReturnValue(200_000);

    supervisor.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(workflowService.startAgent).toHaveBeenCalledWith('task-stall-1', 'new', 'implementor');
    expect(taskEventLog.log).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-stall-1',
      category: 'system',
      severity: 'warning',
      message: expect.stringContaining('restarting implementor'),
    }));
  });

  it('does not trigger recovery when task has a running agent', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);
    agentRunStore.getRunsForTask.mockResolvedValue([makeRun({ status: 'running' })]);
    mockedNow.mockReturnValue(200_000);

    supervisor.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(workflowService.startAgent).not.toHaveBeenCalled();
  });

  it('respects grace period — does not recover recently completed agents', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);

    const completedRun = makeRun({ status: 'completed', completedAt: 150_000 });
    agentRunStore.getRunsForTask.mockResolvedValue([completedRun]);

    // now = 150_000 + 30_000 = 180_000, which is within 60s grace of completedAt
    mockedNow.mockReturnValue(180_000);

    supervisor.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(workflowService.startAgent).not.toHaveBeenCalled();
  });

  it('respects grace period — does not recover recently updated tasks', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);

    // Task was updated very recently
    const task = makeTask({ updatedAt: 195_000 });
    taskStore.listTasks.mockResolvedValue([task]);
    agentRunStore.getRunsForTask.mockResolvedValue([]);

    mockedNow.mockReturnValue(200_000); // only 5s since updatedAt, within 60s grace

    supervisor.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(workflowService.startAgent).not.toHaveBeenCalled();
  });

  it('caps recovery attempts at max (2 by default)', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);
    const previousRun = makeRun({ id: 'run-prev', status: 'completed', completedAt: 1000 });
    agentRunStore.getRunsForTask.mockResolvedValue([previousRun]);
    mockedNow.mockReturnValue(200_000);

    supervisor.start();

    // First poll — attempt 1
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(1);

    // Second poll — attempt 2
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(2);

    // Third poll — should be capped, no more retries
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(2);
  });

  it('ignores tasks not in agent_running status category', async () => {
    const pipeline = makePipeline({
      statuses: [
        { name: 'open', label: 'Open', category: 'ready' },
        { name: 'review', label: 'Review', category: 'human_review' },
        { name: 'done', label: 'Done', category: 'terminal', isFinal: true },
      ],
    });
    pipelineStore.listPipelines.mockResolvedValue([pipeline]);

    // No agent_running statuses → listTasks should not be called
    supervisor.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(taskStore.listTasks).not.toHaveBeenCalled();
    expect(workflowService.startAgent).not.toHaveBeenCalled();
  });

  it('skips stall detection when optional deps are not provided', async () => {
    // Supervisor without stall-detection deps (backward compat)
    const basicSupervisor = new AgentSupervisor(
      agentRunStore as unknown as IAgentRunStore,
      agentService as unknown as IAgentService,
      taskEventLog as unknown as ITaskEventLog,
      1000,
      5000,
    );

    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask()]);

    basicSupervisor.start();
    await vi.advanceTimersByTimeAsync(1000);

    // Should not have called pipeline or task stores
    expect(pipelineStore.listPipelines).not.toHaveBeenCalled();
    expect(taskStore.listTasks).not.toHaveBeenCalled();

    basicSupervisor.stop();
  });

  it('logs warning and skips when no previous runs exist, without consuming recovery slot', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);
    agentRunStore.getRunsForTask.mockResolvedValue([]); // no previous runs
    mockedNow.mockReturnValue(200_000);

    supervisor.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(workflowService.startAgent).not.toHaveBeenCalled();
    expect(taskEventLog.log).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-stall-1',
      category: 'system',
      severity: 'warning',
      message: expect.stringContaining('no previous agent runs found'),
    }));
  });

  it('uses correct agentType from latest run when task has agentType implementor', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);

    const latestRun = makeRun({ id: 'run-impl', status: 'completed', completedAt: 1000, agentType: 'implementor', mode: 'revision' });
    agentRunStore.getRunsForTask.mockResolvedValue([latestRun]);
    mockedNow.mockReturnValue(200_000);

    supervisor.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(workflowService.startAgent).toHaveBeenCalledWith('task-stall-1', 'revision', 'implementor');
  });

  it('logs error when startAgent throws', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);

    const latestRun = makeRun({ id: 'run-prev', status: 'completed', completedAt: 1000 });
    agentRunStore.getRunsForTask.mockResolvedValue([latestRun]);
    mockedNow.mockReturnValue(200_000);

    workflowService.startAgent.mockRejectedValue(new Error('Agent start failed'));

    supervisor.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(taskEventLog.log).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-stall-1',
      category: 'system',
      severity: 'error',
      message: expect.stringContaining('Stall recovery threw'),
    }));
  });
});
