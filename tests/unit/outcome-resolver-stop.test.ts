/**
 * Unit tests for OutcomeResolver.resolveAndTransition — user-stopped agent behaviour.
 *
 * When result.killReason === 'stopped', the outcome resolver must:
 *  1. NOT call tryOutcomeTransition('failed', …) — prevents autoRetry from firing.
 *  2. Log a "stopped by user" audit event instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OutcomeResolver } from '../../src/core/services/outcome-resolver';
import type { AgentRunResult, AgentContext } from '../../src/shared/types';
import type { IPipelineEngine } from '../../src/core/interfaces/pipeline-engine';
import type { ITaskStore } from '../../src/core/interfaces/task-store';
import type { ITaskPhaseStore } from '../../src/core/interfaces/task-phase-store';
import type { ITaskArtifactStore } from '../../src/core/interfaces/task-artifact-store';
import type { ITaskEventLog } from '../../src/core/interfaces/task-event-log';
import type { IWorktreeManager } from '../../src/core/interfaces/worktree-manager';
import type { IGitOps } from '../../src/core/interfaces/git-ops';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeTask() {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: 'Test Task',
    description: null,
    debugInfo: null,
    status: 'implementing',
    priority: 0,
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    exitCode: 1,
    output: '',
    ...overrides,
  };
}

function makeContext(): AgentContext {
  return {
    task: makeTask() as AgentContext['task'],
    project: {
      id: 'proj-1',
      name: 'P',
      path: '/tmp/project',
      description: null,
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    workdir: '/tmp/worktree',
    mode: 'new',
  };
}

interface MockStores {
  pipelineEngine: IPipelineEngine;
  taskStore: ITaskStore;
  taskPhaseStore: ITaskPhaseStore;
  taskArtifactStore: ITaskArtifactStore;
  taskEventLog: ITaskEventLog;
  worktreeManager: IWorktreeManager;
  createGitOps: (cwd: string) => IGitOps;
}

function makeStores(): MockStores {
  const taskStore: ITaskStore = {
    getTask: vi.fn().mockResolvedValue(makeTask()),
    listTasks: vi.fn(),
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
  } as unknown as ITaskStore;

  const taskPhaseStore: ITaskPhaseStore = {
    getActivePhase: vi.fn().mockResolvedValue(null),
    createPhase: vi.fn(),
    updatePhase: vi.fn().mockResolvedValue(undefined),
  } as unknown as ITaskPhaseStore;

  const taskArtifactStore: ITaskArtifactStore = {
    createArtifact: vi.fn().mockResolvedValue(undefined),
  } as unknown as ITaskArtifactStore;

  const taskEventLog: ITaskEventLog = {
    log: vi.fn().mockResolvedValue(undefined),
    getEvents: vi.fn(),
  } as unknown as ITaskEventLog;

  const pipelineEngine: IPipelineEngine = {
    getValidTransitions: vi.fn().mockResolvedValue([]),
    executeTransition: vi.fn(),
  } as unknown as IPipelineEngine;

  const worktreeManager: IWorktreeManager = {
    get: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn().mockResolvedValue(undefined),
    ensureNodeModules: vi.fn(),
  } as unknown as IWorktreeManager;

  const createGitOps = vi.fn().mockReturnValue({
    diff: vi.fn().mockResolvedValue(''),
    fetch: vi.fn().mockResolvedValue(undefined),
    rebase: vi.fn().mockResolvedValue(undefined),
    clean: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue(''),
    revParse: vi.fn().mockResolvedValue('abc123'),
    mergeBase: vi.fn().mockResolvedValue('abc123'),
    rebaseAbort: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGitOps);

  return { pipelineEngine, taskStore, taskPhaseStore, taskArtifactStore, taskEventLog, worktreeManager, createGitOps };
}

function makeResolver(stores: MockStores): OutcomeResolver {
  return new OutcomeResolver(
    stores.createGitOps,
    stores.pipelineEngine,
    stores.taskStore,
    stores.taskPhaseStore,
    stores.taskArtifactStore,
    stores.taskEventLog,
  );
}

const WORKTREE = { branch: 'task/task-1', path: '/tmp/worktree' };
const PHASE = { id: 'phase-1' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OutcomeResolver.resolveAndTransition — user-stopped agent', () => {
  let stores: MockStores;
  let resolver: OutcomeResolver;

  beforeEach(() => {
    stores = makeStores();
    resolver = makeResolver(stores);
  });

  it('does NOT call tryOutcomeTransition when killReason === "stopped"', async () => {
    const result = makeResult({ exitCode: 1, killReason: 'stopped' });

    await resolver.resolveAndTransition({
      taskId: 'task-1',
      result,
      run: { id: 'run-1' },
      worktree: WORKTREE,
      worktreeManager: stores.worktreeManager,
      phase: PHASE,
      context: makeContext(),
    });

    // tryOutcomeTransition calls pipelineEngine.getValidTransitions internally.
    // It must NOT be called for stopped agents.
    expect(stores.pipelineEngine.getValidTransitions).not.toHaveBeenCalled();
  });

  it('logs a "stopped by user" audit event when killReason === "stopped"', async () => {
    const result = makeResult({ exitCode: 1, killReason: 'stopped' });

    await resolver.resolveAndTransition({
      taskId: 'task-1',
      result,
      run: { id: 'run-1' },
      worktree: WORKTREE,
      worktreeManager: stores.worktreeManager,
      phase: PHASE,
      context: makeContext(),
    });

    const logCalls = (stores.taskEventLog.log as ReturnType<typeof vi.fn>).mock.calls;
    const stoppedLogCall = logCalls.find(
      ([entry]: [{ message?: string }]) =>
        typeof entry?.message === 'string' &&
        entry.message.toLowerCase().includes('stopped by user'),
    );
    expect(stoppedLogCall).toBeDefined();
  });

  it('DOES call tryOutcomeTransition when exitCode !== 0 and killReason is NOT "stopped"', async () => {
    const result = makeResult({ exitCode: 1, killReason: undefined });

    await resolver.resolveAndTransition({
      taskId: 'task-1',
      result,
      run: { id: 'run-1' },
      worktree: WORKTREE,
      worktreeManager: stores.worktreeManager,
      phase: PHASE,
      context: makeContext(),
    });

    // tryOutcomeTransition should be attempted for genuine failures
    expect(stores.pipelineEngine.getValidTransitions).toHaveBeenCalled();
  });

  it('DOES call tryOutcomeTransition when exitCode !== 0 and killReason is "timeout"', async () => {
    const result = makeResult({ exitCode: 1, killReason: 'timeout' });

    await resolver.resolveAndTransition({
      taskId: 'task-1',
      result,
      run: { id: 'run-1' },
      worktree: WORKTREE,
      worktreeManager: stores.worktreeManager,
      phase: PHASE,
      context: makeContext(),
    });

    expect(stores.pipelineEngine.getValidTransitions).toHaveBeenCalled();
  });

  it('does NOT call tryOutcomeTransition when exitCode === 0 (successful run)', async () => {
    const result = makeResult({ exitCode: 0, outcome: 'pr_ready' });
    // Make getValidTransitions return a transition so that tryOutcomeTransition succeeds
    (stores.pipelineEngine.getValidTransitions as ReturnType<typeof vi.fn>).mockResolvedValue([
      { to: 'pr_review', agentOutcome: 'pr_ready' },
    ]);
    (stores.pipelineEngine.executeTransition as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await resolver.resolveAndTransition({
      taskId: 'task-1',
      result,
      run: { id: 'run-1' },
      worktree: WORKTREE,
      worktreeManager: stores.worktreeManager,
      phase: PHASE,
      context: makeContext(),
    });

    // Success path calls tryOutcomeTransition with the outcome (not 'failed')
    // The 'failed' transition path must NOT have been called.
    const getValidCalls = (stores.pipelineEngine.getValidTransitions as ReturnType<typeof vi.fn>).mock.calls;
    // All calls should be for the success outcome, not 'failed'
    // (In this test getValidTransitions is called once for pr_ready)
    expect(getValidCalls.length).toBe(1);
  });
});
