import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentSupervisor, normalizeError, hashError } from '../../src/core/services/agent-supervisor';
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

  it('calls workflowService.startAgent with correct agentType from pipeline transitions for a stalled task', async () => {
    const pipeline = makePipeline({
      transitions: [
        { from: 'open', to: 'implementing', trigger: 'manual',
          hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'implementor' }, policy: 'fire_and_forget' }] },
      ],
    });
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

  it('uses pipeline-derived agentType even when latest run has a different agentType (bug fix: wrong agent restart)', async () => {
    // Scenario: task is in "implementing" but the latest run was a "reviewer"
    // (caused by hook failure rollback + fire_and_forget reviewer starting before rollback).
    // The supervisor should restart "implementor" (from pipeline), NOT "reviewer" (from latest run).
    const pipeline = makePipeline({
      transitions: [
        { from: 'open', to: 'implementing', trigger: 'manual',
          hooks: [{ name: 'start_agent', params: { mode: 'new', agentType: 'implementor' }, policy: 'fire_and_forget' }] },
      ],
    });
    pipelineStore.listPipelines.mockResolvedValue([pipeline]);

    const task = makeTask({ updatedAt: 1000 });
    taskStore.listTasks.mockResolvedValue([task]);

    // Latest run is a REVIEWER (wrong agent type for "implementing" status)
    const reviewerRun = makeRun({ id: 'run-reviewer', status: 'completed', completedAt: 1000, agentType: 'reviewer', mode: 'new' });
    agentRunStore.getRunsForTask.mockResolvedValue([reviewerRun]);

    mockedNow.mockReturnValue(200_000);

    supervisor.start();
    await vi.advanceTimersByTimeAsync(1000);

    // Should restart implementor (from pipeline), NOT reviewer (from latest run)
    expect(workflowService.startAgent).toHaveBeenCalledWith('task-stall-1', 'new', 'implementor');
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

  it('falls back to latest run agentType when pipeline has no start_agent hook for the status', async () => {
    // Pipeline with no transitions defining start_agent for "implementing"
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

// ========================================
// Error normalization & hashing
// ========================================

describe('normalizeError', () => {
  it('strips UUIDs from error messages', () => {
    const msg = 'Failed for session a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(normalizeError(msg)).toBe('Failed for session <UUID>');
  });

  it('strips hex strings ≥8 chars (commit SHAs, ref hashes)', () => {
    const msg = "cannot lock ref 'refs/heads/abc12def34'";
    expect(normalizeError(msg)).toBe("cannot lock ref 'refs/heads/<HEX>'");
  });

  it('strips purely numeric sequences ≥6 digits', () => {
    const msg = 'Timeout after 1234567890ms for request 123456';
    expect(normalizeError(msg)).toBe('Timeout after <NUM>ms for request <NUM>');
  });

  it('treats "cannot lock ref abc123ef" and "cannot lock ref def456ab" as the same class', () => {
    const err1 = "cannot lock ref 'refs/heads/abc123ef'";
    const err2 = "cannot lock ref 'refs/heads/def456ab'";
    expect(hashError(err1)).toBe(hashError(err2));
  });

  it('does not strip short hex or numeric strings that may be meaningful', () => {
    const msg = 'Error code A1B2 on port 8080';
    // A1B2 is only 4 hex chars (< 8), 8080 is only 4 digits (< 6) — neither should be stripped
    expect(normalizeError(msg)).toBe('Error code A1B2 on port 8080');
  });
});

describe('hashError', () => {
  it('produces identical hashes for structurally identical errors', () => {
    const hash1 = hashError("fatal: cannot lock ref 'refs/heads/abcdef12': exists");
    const hash2 = hashError("fatal: cannot lock ref 'refs/heads/98765432': exists");
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for structurally different errors', () => {
    const hash1 = hashError('cannot lock ref');
    const hash2 = hashError('permission denied');
    expect(hash1).not.toBe(hash2);
  });

  it('returns a numeric string', () => {
    const h = hashError('some error');
    expect(h).toMatch(/^\d+$/);
  });
});

// ========================================
// Error deduplication in stall recovery
// ========================================

describe('AgentSupervisor — error deduplication', () => {
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
    setPendingResume: ReturnType<typeof vi.fn>;
    clearPendingResume: ReturnType<typeof vi.fn>;
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
      setPendingResume: vi.fn(),
      clearPendingResume: vi.fn(),
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

  it('stops recovery when startAgent throws the same error on 2 consecutive polls', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);

    const failedRun = makeRun({ id: 'run-prev', status: 'completed', completedAt: 1000 });
    agentRunStore.getRunsForTask.mockResolvedValue([failedRun]);
    mockedNow.mockReturnValue(200_000);

    // startAgent always throws the same error
    workflowService.startAgent.mockRejectedValue(new Error('cannot lock ref abc12345'));

    supervisor.start();

    // Poll 1: first attempt — startAgent fails, error hash recorded
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(1);

    // Poll 2: second attempt — startAgent fails with same error, hash matches → dedup triggers
    // But the dedup check happens BEFORE the attempt, and the hash was recorded in the catch block.
    // So on poll 2, the error hash array has 1 entry (from poll 1 catch).
    // The attempt will go through, fail, and add a second identical hash.
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(2);

    // Poll 3: dedup check now sees 2 identical hashes → skips recovery, logs escalation
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(2); // no more calls

    // Verify the escalation log was emitted
    expect(taskEventLog.log).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-stall-1',
      category: 'system',
      severity: 'error',
      message: expect.stringContaining('deterministic failure detected'),
    }));
  });

  it('continues recovery when errors differ between polls', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);

    const failedRun = makeRun({ id: 'run-prev', status: 'completed', completedAt: 1000 });
    agentRunStore.getRunsForTask.mockResolvedValue([failedRun]);
    mockedNow.mockReturnValue(200_000);

    // Different errors on each call
    workflowService.startAgent
      .mockRejectedValueOnce(new Error('cannot lock ref abc12345'))
      .mockRejectedValueOnce(new Error('permission denied'));

    supervisor.start();

    // Poll 1: first error
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(1);

    // Poll 2: different error — should NOT trigger dedup, still attempts recovery
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(2);

    // Poll 3: cap reached (MAX_STALL_RECOVERY_ATTEMPTS = 2), but dedup did NOT trigger
    // (the escalation log should NOT have been emitted for deterministic failure)
    const escalationCalls = taskEventLog.log.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'object' && call[0] !== null &&
        'message' in (call[0] as Record<string, unknown>) &&
        String((call[0] as Record<string, unknown>).message).includes('deterministic failure detected'),
    );
    expect(escalationCalls).toHaveLength(0);
  });

  it('logs escalation event with correct data when deterministic failure detected', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);

    const failedRun = makeRun({ id: 'run-prev', status: 'completed', completedAt: 1000 });
    agentRunStore.getRunsForTask.mockResolvedValue([failedRun]);
    mockedNow.mockReturnValue(200_000);

    const deterministicError = "fatal: cannot lock ref 'refs/heads/feature-branch'";
    workflowService.startAgent.mockRejectedValue(new Error(deterministicError));

    supervisor.start();

    // Two polls to build up error history, third poll triggers escalation
    await vi.advanceTimersByTimeAsync(1000); // poll 1: attempt + fail
    await vi.advanceTimersByTimeAsync(1000); // poll 2: attempt + fail
    await vi.advanceTimersByTimeAsync(1000); // poll 3: dedup triggers

    const escalationCall = taskEventLog.log.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'object' && call[0] !== null &&
        'message' in (call[0] as Record<string, unknown>) &&
        String((call[0] as Record<string, unknown>).message).includes('deterministic failure detected'),
    );

    expect(escalationCall).toBeDefined();
    const logEntry = escalationCall![0] as Record<string, unknown>;
    expect(logEntry.severity).toBe('error');
    expect(logEntry.message).toContain('deterministic failure detected');
    expect(logEntry.message).toContain('task-stall-1');
    expect((logEntry.data as Record<string, unknown>).consecutiveCount).toBe(2);
  });

  it('successful recovery clears error history', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);

    const failedRun = makeRun({ id: 'run-prev', status: 'completed', completedAt: 1000 });
    agentRunStore.getRunsForTask.mockResolvedValue([failedRun]);
    mockedNow.mockReturnValue(200_000);

    // First call fails, second succeeds
    workflowService.startAgent
      .mockRejectedValueOnce(new Error('cannot lock ref abc12345'))
      .mockResolvedValueOnce(makeRun());

    supervisor.start();

    // Poll 1: fails — error hash recorded
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(1);

    // Poll 2: succeeds — error history should be cleared
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(2);

    // Verify the success log was emitted (confirms recovery went through)
    expect(taskEventLog.log).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-stall-1',
      category: 'system',
      severity: 'info',
      message: expect.stringContaining('Stall recovery succeeded'),
    }));

    // No deterministic failure escalation should exist
    const escalationCalls = taskEventLog.log.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'object' && call[0] !== null &&
        'message' in (call[0] as Record<string, unknown>) &&
        String((call[0] as Record<string, unknown>).message).includes('deterministic failure detected'),
    );
    expect(escalationCalls).toHaveLength(0);
  });

  it('clears error history when task has a running agent', async () => {
    pipelineStore.listPipelines.mockResolvedValue([makePipeline()]);
    taskStore.listTasks.mockResolvedValue([makeTask({ updatedAt: 1000 })]);

    // First poll: task has no running agent, startAgent fails
    const failedRun = makeRun({ id: 'run-prev', status: 'completed', completedAt: 1000 });
    agentRunStore.getRunsForTask.mockResolvedValueOnce([failedRun]);
    workflowService.startAgent.mockRejectedValueOnce(new Error('cannot lock ref abc12345'));
    mockedNow.mockReturnValue(200_000);

    supervisor.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(1);

    // Second poll: task now has a running agent — error history should be cleared
    agentRunStore.getRunsForTask.mockResolvedValueOnce([makeRun({ status: 'running' })]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(workflowService.startAgent).toHaveBeenCalledTimes(1); // no new recovery

    // Third poll: task stalls again with same error — should attempt recovery
    // (because error history was cleared when agent was running)
    agentRunStore.getRunsForTask.mockResolvedValue([failedRun]);
    workflowService.startAgent.mockRejectedValue(new Error('cannot lock ref abc12345'));
    await vi.advanceTimersByTimeAsync(1000);
    // Recovery cap is already at 1 from the first poll. This adds attempt 2.
    // But error history was cleared, so no dedup block — it should attempt again.
    expect(workflowService.startAgent).toHaveBeenCalledTimes(2);
  });
});
