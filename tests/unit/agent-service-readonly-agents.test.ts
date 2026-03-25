/**
 * Unit tests for AgentService.execute() — read-only agent worktree behavior.
 *
 * Read-only agents (post-mortem-reviewer, task-workflow-reviewer, investigator, reviewer)
 * should skip branch creation/switching and git clean/rebase since they don't commit code.
 * This prevents git ref hierarchy conflicts (e.g., task/{id}/task-workflow-reviewer blocking
 * creation of task/{id}).
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentService } from '../../src/core/services/agent-service';
import type { IAgentFramework } from '../../src/core/interfaces/agent-framework';
import type { IAgentRunStore } from '../../src/core/interfaces/agent-run-store';
import type { IWorktreeManager } from '../../src/core/interfaces/worktree-manager';
import type { ITaskStore } from '../../src/core/interfaces/task-store';
import type { IProjectStore } from '../../src/core/interfaces/project-store';
import type { ITaskEventLog } from '../../src/core/interfaces/task-event-log';
import type { ITaskPhaseStore } from '../../src/core/interfaces/task-phase-store';
import type { IPendingPromptStore } from '../../src/core/interfaces/pending-prompt-store';
import type { ITaskContextStore } from '../../src/core/interfaces/task-context-store';
import type { IAgentDefinitionStore } from '../../src/core/interfaces/agent-definition-store';
import type { INotificationRouter } from '../../src/core/interfaces/notification-router';
import type { IAgent } from '../../src/core/interfaces/agent';
import type { AgentRun } from '../../src/shared/types';
import type { ValidationRunner } from '../../src/core/services/validation-runner';
import type { OutcomeResolver } from '../../src/core/services/outcome-resolver';
import type { IGitOps } from '../../src/core/interfaces/git-ops';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    taskId: 'task-1',
    agentType: 'post-mortem-reviewer',
    mode: 'new',
    status: 'running',
    output: null,
    outcome: null,
    payload: {},
    exitCode: null,
    startedAt: Date.now(),
    completedAt: null,
    costInputTokens: null,
    costOutputTokens: null,
    prompt: null,
    error: null,
    timeoutMs: null,
    maxTurns: null,
    messageCount: null,
    messages: null,
    automatedAgentId: null,
    ...overrides,
  };
}

function makeTask() {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: 'Test Task',
    description: null,
    debugInfo: null,
    status: 'defective',
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

// ---------------------------------------------------------------------------
// Factory for mocked dependencies
// ---------------------------------------------------------------------------

function makeMockedDeps() {
  const mockGitOps: IGitOps = {
    fetch: vi.fn().mockResolvedValue(undefined),
    clean: vi.fn().mockResolvedValue(undefined),
    rebase: vi.fn().mockResolvedValue(undefined),
    rebaseAbort: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    createBranchRef: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue(''),
    diff: vi.fn().mockResolvedValue(''),
    diffStat: vi.fn().mockResolvedValue(''),
    revParse: vi.fn().mockResolvedValue('abc'),
    push: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue([]),
    cherryPick: vi.fn().mockResolvedValue(undefined),
    merge: vi.fn().mockResolvedValue(undefined),
    mergeAbort: vi.fn().mockResolvedValue(undefined),
    commitAmend: vi.fn().mockResolvedValue(undefined),
    stash: vi.fn().mockResolvedValue(undefined),
    stashPop: vi.fn().mockResolvedValue(undefined),
  } as unknown as IGitOps;
  const createGitOps = vi.fn().mockReturnValue(mockGitOps);

  const mockWorktreeManager: IWorktreeManager = {
    get: vi.fn().mockResolvedValue({ branch: 'task/task-1/work', path: '/tmp/worktree' }),
    create: vi.fn().mockResolvedValue({ branch: 'task/task-1/work', path: '/tmp/worktree' }),
    delete: vi.fn().mockResolvedValue(undefined),
    lock: vi.fn().mockResolvedValue(undefined),
    unlock: vi.fn().mockResolvedValue(undefined),
    ensureNodeModules: vi.fn().mockResolvedValue(undefined),
  } as unknown as IWorktreeManager;
  const createWorktreeManager = vi.fn().mockReturnValue(mockWorktreeManager);

  const agent: IAgent = {
    type: 'post-mortem-reviewer',
    execute: vi.fn().mockResolvedValue({ exitCode: 0, output: 'done', outcome: 'review_complete' }),
    stop: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
  };

  const agentRunStore: IAgentRunStore = {
    createRun: vi.fn().mockResolvedValue(makeRun()),
    updateRun: vi.fn().mockResolvedValue(null),
    getRun: vi.fn().mockResolvedValue(null),
    getRunsForTask: vi.fn().mockResolvedValue([]),
    getAllRuns: vi.fn().mockResolvedValue([]),
    getActiveRuns: vi.fn().mockResolvedValue([]),
    getRunsForAutomatedAgent: vi.fn().mockResolvedValue([]),
    getActiveRunForAutomatedAgent: vi.fn().mockResolvedValue(null),
  } as unknown as IAgentRunStore;

  const taskEventLog: ITaskEventLog = {
    log: vi.fn().mockResolvedValue(undefined),
    getEvents: vi.fn(),
  } as unknown as ITaskEventLog;

  const taskStore: ITaskStore = {
    getTask: vi.fn().mockResolvedValue(makeTask()),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn(),
    resetTask: vi.fn(),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
    getDependencies: vi.fn(),
    getDependents: vi.fn(),
    getStatusCounts: vi.fn(),
    getTotalCount: vi.fn(),
  } as unknown as ITaskStore;

  const projectStore: IProjectStore = {
    getProject: vi.fn().mockResolvedValue({
      id: 'proj-1',
      name: 'P',
      path: '/tmp/project',
      description: null,
      config: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  } as unknown as IProjectStore;

  const taskContextStore: ITaskContextStore = {
    getEntriesForTask: vi.fn().mockResolvedValue([]),
  } as unknown as ITaskContextStore;

  const taskPhaseStore: ITaskPhaseStore = {
    getActivePhase: vi.fn().mockResolvedValue({ id: 'phase-1' }),
    createPhase: vi.fn().mockResolvedValue({ id: 'phase-1' }),
    updatePhase: vi.fn().mockResolvedValue(undefined),
  } as unknown as ITaskPhaseStore;

  const agentDefinitionStore: IAgentDefinitionStore = {
    getDefinition: vi.fn().mockResolvedValue(null),
  } as unknown as IAgentDefinitionStore;

  const pendingPromptStore: IPendingPromptStore = {
    expirePromptsForRun: vi.fn().mockResolvedValue(undefined),
  } as unknown as IPendingPromptStore;

  const notificationRouter: INotificationRouter = {
    send: vi.fn().mockResolvedValue(undefined),
  };

  const agentFramework: IAgentFramework = {
    registerAgent: vi.fn(),
    getAgent: vi.fn().mockReturnValue(agent),
    listAgents: vi.fn().mockReturnValue([]),
    getAvailableAgents: vi.fn().mockResolvedValue([]),
  };

  const outcomeResolver: OutcomeResolver = {
    resolveAndTransition: vi.fn().mockResolvedValue(undefined),
    tryOutcomeTransition: vi.fn().mockResolvedValue(undefined),
  } as unknown as OutcomeResolver;

  const validationRunner = {
    runWithRetries: vi.fn(),
  } as unknown as ValidationRunner;

  const service = new AgentService(
    agentFramework,
    agentRunStore,
    createWorktreeManager,
    taskStore,
    projectStore,
    taskEventLog,
    taskPhaseStore,
    pendingPromptStore,
    createGitOps,
    taskContextStore,
    agentDefinitionStore,
    undefined, // taskReviewReportBuilder
    notificationRouter,
    validationRunner,
    outcomeResolver,
  );

  return {
    service,
    mockGitOps,
    createGitOps,
    mockWorktreeManager,
    createWorktreeManager,
    agent,
    agentRunStore,
    taskEventLog,
    taskStore,
    projectStore,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentService.execute() — read-only agent worktree behavior', () => {
  it('skips branch switching for read-only agent when worktree exists', async () => {
    const { service, mockGitOps } = makeMockedDeps();

    // execute() returns immediately with the run — agent work happens in background
    const run = await service.execute('task-1', 'new', 'post-mortem-reviewer');

    expect(run).toBeDefined();
    expect(run.status).toBe('running');

    // Wait a tick for the background promise to settle
    await new Promise(r => setTimeout(r, 50));

    // Read-only agent should NOT trigger branch creation or checkout
    expect(mockGitOps.createBranch).not.toHaveBeenCalled();
    expect(mockGitOps.checkout).not.toHaveBeenCalled();
  });

  it('skips git clean/rebase for read-only agent', async () => {
    const { service, mockGitOps } = makeMockedDeps();

    await service.execute('task-1', 'new', 'post-mortem-reviewer');
    await new Promise(r => setTimeout(r, 50));

    // Read-only agent should NOT trigger worktree clean or rebase
    expect(mockGitOps.clean).not.toHaveBeenCalled();
    expect(mockGitOps.rebase).not.toHaveBeenCalled();
    expect(mockGitOps.fetch).not.toHaveBeenCalled();
  });

  it('skips branch switching for task-workflow-reviewer', async () => {
    const { service, mockGitOps } = makeMockedDeps();

    await service.execute('task-1', 'new', 'task-workflow-reviewer');
    await new Promise(r => setTimeout(r, 50));

    expect(mockGitOps.createBranch).not.toHaveBeenCalled();
    expect(mockGitOps.checkout).not.toHaveBeenCalled();
    expect(mockGitOps.clean).not.toHaveBeenCalled();
    expect(mockGitOps.rebase).not.toHaveBeenCalled();
  });

  it('skips branch switching for investigator', async () => {
    const { service, mockGitOps } = makeMockedDeps();

    await service.execute('task-1', 'new', 'investigator');
    await new Promise(r => setTimeout(r, 50));

    expect(mockGitOps.createBranch).not.toHaveBeenCalled();
    expect(mockGitOps.checkout).not.toHaveBeenCalled();
  });

  it('skips branch switching for reviewer', async () => {
    const { service, mockGitOps, agentRunStore } = makeMockedDeps();

    // Reviewer looks up prior implementor runs for session resume
    (agentRunStore.getRunsForTask as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await service.execute('task-1', 'new', 'reviewer');
    await new Promise(r => setTimeout(r, 50));

    expect(mockGitOps.createBranch).not.toHaveBeenCalled();
    expect(mockGitOps.checkout).not.toHaveBeenCalled();
  });

  it('logs skip reason for read-only agents in event log', async () => {
    const { service, taskEventLog } = makeMockedDeps();

    await service.execute('task-1', 'new', 'post-mortem-reviewer');
    await new Promise(r => setTimeout(r, 50));

    const logCalls = (taskEventLog.log as ReturnType<typeof vi.fn>).mock.calls;
    const skipBranchLog = logCalls.find(
      ([entry]: [{ message: string }]) =>
        entry.message.includes('read-only agent') && entry.message.includes('skipping branch switch'),
    );
    expect(skipBranchLog).toBeDefined();

    const skipCleanLog = logCalls.find(
      ([entry]: [{ message: string }]) =>
        entry.message.includes('read-only agent') && entry.message.includes('does not modify the worktree'),
    );
    expect(skipCleanLog).toBeDefined();
  });

  it('still creates worktree for read-only agent when none exists', async () => {
    const { service, mockWorktreeManager } = makeMockedDeps();

    // Simulate no existing worktree
    (mockWorktreeManager.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await service.execute('task-1', 'new', 'post-mortem-reviewer');
    await new Promise(r => setTimeout(r, 50));

    // Worktree should still be created (agent needs a working directory)
    expect(mockWorktreeManager.create).toHaveBeenCalled();
  });

  it('does NOT skip branch switching for non-read-only agent (implementor)', async () => {
    const { service, mockGitOps, mockWorktreeManager } = makeMockedDeps();

    // Simulate worktree exists with a different branch
    (mockWorktreeManager.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      branch: 'some-other-branch',
      path: '/tmp/worktree',
    });

    await service.execute('task-1', 'new', 'implementor');
    await new Promise(r => setTimeout(r, 50));

    // Non-read-only agent SHOULD trigger branch creation
    expect(mockGitOps.createBranch).toHaveBeenCalled();
  });
});

describe('AgentService — git ref hierarchy conflict regex', () => {
  it('handles "exists; cannot create" error by falling back to checkout', async () => {
    const { service, mockGitOps, mockWorktreeManager } = makeMockedDeps();

    // Simulate worktree exists with a different branch (triggers branch switch)
    (mockWorktreeManager.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      branch: 'some-other-branch',
      path: '/tmp/worktree',
    });

    // Simulate git ref hierarchy conflict
    (mockGitOps.createBranch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("fatal: 'refs/heads/task/task-1/task-workflow-reviewer' exists; cannot create 'refs/heads/task/task-1/work'"),
    );

    // Should not throw — should fall back to checkout
    const run = await service.execute('task-1', 'new', 'implementor');
    expect(run).toBeDefined();

    await new Promise(r => setTimeout(r, 50));

    // Should have tried createBranch, then fallen back to checkout
    expect(mockGitOps.createBranch).toHaveBeenCalled();
    expect(mockGitOps.checkout).toHaveBeenCalledWith('task/task-1/work');
  });

  it('still handles standard "already exists" error', async () => {
    const { service, mockGitOps, mockWorktreeManager } = makeMockedDeps();

    (mockWorktreeManager.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      branch: 'some-other-branch',
      path: '/tmp/worktree',
    });

    (mockGitOps.createBranch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("fatal: a branch named 'task/task-1/work' already exists"),
    );

    const run = await service.execute('task-1', 'new', 'implementor');
    expect(run).toBeDefined();

    await new Promise(r => setTimeout(r, 50));

    expect(mockGitOps.checkout).toHaveBeenCalledWith('task/task-1/work');
  });
});
