/**
 * Unit tests for AgentService.runAgentInBackground — status persistence for stopped agents.
 *
 * When an agent is user-stopped (result.killReason === 'stopped'), the background
 * execution handler must persist status = 'cancelled' (not 'failed') to the DB.
 * Persisting 'failed' would overwrite the 'cancelled' status already written by
 * stop() and trigger the autoRetry pipeline transition.
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
import type { AgentRun, AgentContext, AgentConfig } from '../../src/shared/types';
import type { ValidationRunner } from '../../src/core/services/validation-runner';
import type { OutcomeResolver } from '../../src/core/services/outcome-resolver';

// ---------------------------------------------------------------------------
// Minimal helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-bg-1',
    taskId: 'task-bg-1',
    agentType: 'planner',
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
    id: 'task-bg-1',
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: 'Background Test Task',
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

function makeContext(): AgentContext {
  return {
    task: makeTask() as AgentContext['task'],
    project: {
      id: 'proj-1',
      name: 'P',
      path: '/tmp/project',
      description: null,
      config: {},  // no validationCommands → validation skipped
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    workdir: '/tmp/worktree',
    mode: 'new',
    sessionId: 'run-bg-1',
    resumeSession: false,
  };
}

function makeConfig(): AgentConfig {
  return { engine: 'claude-code' };
}

// ---------------------------------------------------------------------------
// Service factory (minimal mocks)
// ---------------------------------------------------------------------------

interface ServiceDeps {
  agentRunStore: IAgentRunStore;
  taskEventLog: ITaskEventLog;
  taskStore: ITaskStore;
  taskContextStore: ITaskContextStore;
  taskPhaseStore: ITaskPhaseStore;
  outcomeResolver: OutcomeResolver;
  notificationRouter: INotificationRouter;
  agentFramework: IAgentFramework;
  createWorktreeManager: (projectPath: string) => IWorktreeManager;
}

function makeDeps(agent: IAgent): ServiceDeps {
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

  const taskContextStore: ITaskContextStore = {
    getEntriesForTask: vi.fn().mockResolvedValue([]),
  } as unknown as ITaskContextStore;

  const taskPhaseStore: ITaskPhaseStore = {
    getActivePhase: vi.fn().mockResolvedValue({ id: 'phase-1' }),
    createPhase: vi.fn().mockResolvedValue({ id: 'phase-1' }),
    updatePhase: vi.fn().mockResolvedValue(undefined),
  } as unknown as ITaskPhaseStore;

  const outcomeResolver: OutcomeResolver = {
    resolveAndTransition: vi.fn().mockResolvedValue(undefined),
    tryOutcomeTransition: vi.fn().mockResolvedValue(undefined),
  } as unknown as OutcomeResolver;

  const notificationRouter: INotificationRouter = {
    send: vi.fn().mockResolvedValue(undefined),
  };

  const agentFramework: IAgentFramework = {
    registerAgent: vi.fn(),
    getAgent: vi.fn().mockReturnValue(agent),
    listAgents: vi.fn().mockReturnValue([]),
    getAvailableAgents: vi.fn().mockResolvedValue([]),
  };

  const mockWorktreeManager: IWorktreeManager = {
    get: vi.fn().mockResolvedValue({ branch: 'task/task-bg-1', path: '/tmp/worktree' }),
    create: vi.fn(),
    delete: vi.fn(),
    lock: vi.fn().mockResolvedValue(undefined),
    unlock: vi.fn().mockResolvedValue(undefined),
    ensureNodeModules: vi.fn().mockResolvedValue(undefined),
  } as unknown as IWorktreeManager;

  const createWorktreeManager = vi.fn().mockReturnValue(mockWorktreeManager);

  return {
    agentRunStore,
    taskEventLog,
    taskStore,
    taskContextStore,
    taskPhaseStore,
    outcomeResolver,
    notificationRouter,
    agentFramework,
    createWorktreeManager,
  };
}

function makeAgentService(deps: ServiceDeps): AgentService {
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

  const agentDefinitionStore: IAgentDefinitionStore = {
    getDefinition: vi.fn().mockResolvedValue(null),
  } as unknown as IAgentDefinitionStore;

  const pendingPromptStore: IPendingPromptStore = {
    expirePromptsForRun: vi.fn().mockResolvedValue(undefined),
  } as unknown as IPendingPromptStore;

  const validationRunner = {
    runWithRetries: vi.fn(),
  } as unknown as ValidationRunner;

  const createGitOps = vi.fn().mockReturnValue({
    fetch: vi.fn().mockResolvedValue(undefined),
    clean: vi.fn().mockResolvedValue(undefined),
    rebase: vi.fn().mockResolvedValue(undefined),
    rebaseAbort: vi.fn().mockResolvedValue(undefined),
    checkout: vi.fn().mockResolvedValue(undefined),
    createBranch: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue(''),
    diff: vi.fn().mockResolvedValue(''),
    revParse: vi.fn().mockResolvedValue('abc'),
    push: vi.fn().mockResolvedValue(undefined),
    createBranchRef: vi.fn().mockResolvedValue(undefined),
  });

  return new AgentService(
    deps.agentFramework,
    deps.agentRunStore,
    deps.createWorktreeManager,
    deps.taskStore,
    projectStore,
    deps.taskEventLog,
    deps.taskPhaseStore,
    pendingPromptStore,
    createGitOps,
    deps.taskContextStore,
    agentDefinitionStore,
    undefined, // taskReviewReportBuilder
    deps.notificationRouter,
    validationRunner,
    deps.outcomeResolver,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentService.runAgentInBackground — cancelled status for stopped agents', () => {
  it('persists status="cancelled" when agent result has killReason="stopped"', async () => {
    const stoppedResult = {
      exitCode: 1,
      killReason: 'stopped',
      output: '',
      error: 'Agent aborted [kill_reason=stopped]',
    };

    const agent: IAgent = {
      type: 'planner',
      execute: vi.fn().mockResolvedValue(stoppedResult),
      stop: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const deps = makeDeps(agent);
    const service = makeAgentService(deps);

    const run = makeRun();
    const task = makeTask();
    const context = makeContext();
    const config = makeConfig();
    const phase = { id: 'phase-1' };
    const worktree = { branch: 'task/task-bg-1', path: '/tmp/worktree' };
    const worktreeManager = (deps.createWorktreeManager as ReturnType<typeof vi.fn>)();

    // Directly invoke the private method via type-casting
    await (service as unknown as {
      runAgentInBackground(
        agent: IAgent,
        context: AgentContext,
        config: AgentConfig,
        run: AgentRun,
        task: ReturnType<typeof makeTask>,
        phase: { id: string },
        worktree: { branch: string; path: string },
        worktreeManager: IWorktreeManager,
        agentType: string,
      ): Promise<void>;
    }).runAgentInBackground(
      agent,
      context,
      config,
      run,
      task,
      phase,
      worktree,
      worktreeManager,
      'planner',
    );

    // The key assertion: updateRun must have been called with status='cancelled'
    const updateRunCalls = (deps.agentRunStore.updateRun as ReturnType<typeof vi.fn>).mock.calls;
    const statusUpdateCall = updateRunCalls.find(
      ([_id, updates]: [string, Record<string, unknown>]) =>
        updates && ('status' in updates),
    );
    expect(statusUpdateCall).toBeDefined();
    expect(statusUpdateCall![1]).toMatchObject({ status: 'cancelled' });
  });

  it('persists status="failed" when agent result has no killReason (genuine failure)', async () => {
    const failedResult = {
      exitCode: 1,
      output: '',
      error: 'Agent encountered an error',
    };

    const agent: IAgent = {
      type: 'planner',
      execute: vi.fn().mockResolvedValue(failedResult),
      stop: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const deps = makeDeps(agent);
    const service = makeAgentService(deps);

    const run = makeRun();
    const task = makeTask();
    const context = makeContext();
    const config = makeConfig();
    const phase = { id: 'phase-1' };
    const worktree = { branch: 'task/task-bg-1', path: '/tmp/worktree' };
    const worktreeManager = (deps.createWorktreeManager as ReturnType<typeof vi.fn>)();

    await (service as unknown as {
      runAgentInBackground(
        agent: IAgent,
        context: AgentContext,
        config: AgentConfig,
        run: AgentRun,
        task: ReturnType<typeof makeTask>,
        phase: { id: string },
        worktree: { branch: string; path: string },
        worktreeManager: IWorktreeManager,
        agentType: string,
      ): Promise<void>;
    }).runAgentInBackground(
      agent,
      context,
      config,
      run,
      task,
      phase,
      worktree,
      worktreeManager,
      'planner',
    );

    const updateRunCalls = (deps.agentRunStore.updateRun as ReturnType<typeof vi.fn>).mock.calls;
    const statusUpdateCall = updateRunCalls.find(
      ([_id, updates]: [string, Record<string, unknown>]) =>
        updates && ('status' in updates),
    );
    expect(statusUpdateCall).toBeDefined();
    expect(statusUpdateCall![1]).toMatchObject({ status: 'failed' });
  });

  it('persists status="completed" when agent result has exitCode=0', async () => {
    const successResult = {
      exitCode: 0,
      output: 'done',
      outcome: 'pr_ready',
    };

    const agent: IAgent = {
      type: 'planner',
      execute: vi.fn().mockResolvedValue(successResult),
      stop: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn().mockResolvedValue(true),
    };

    const deps = makeDeps(agent);
    const service = makeAgentService(deps);

    const run = makeRun();
    const task = makeTask();
    const context = makeContext();
    const config = makeConfig();
    const phase = { id: 'phase-1' };
    const worktree = { branch: 'task/task-bg-1', path: '/tmp/worktree' };
    const worktreeManager = (deps.createWorktreeManager as ReturnType<typeof vi.fn>)();

    await (service as unknown as {
      runAgentInBackground(
        agent: IAgent,
        context: AgentContext,
        config: AgentConfig,
        run: AgentRun,
        task: ReturnType<typeof makeTask>,
        phase: { id: string },
        worktree: { branch: string; path: string },
        worktreeManager: IWorktreeManager,
        agentType: string,
      ): Promise<void>;
    }).runAgentInBackground(
      agent,
      context,
      config,
      run,
      task,
      phase,
      worktree,
      worktreeManager,
      'planner',
    );

    const updateRunCalls = (deps.agentRunStore.updateRun as ReturnType<typeof vi.fn>).mock.calls;
    const statusUpdateCall = updateRunCalls.find(
      ([_id, updates]: [string, Record<string, unknown>]) =>
        updates && ('status' in updates),
    );
    expect(statusUpdateCall).toBeDefined();
    expect(statusUpdateCall![1]).toMatchObject({ status: 'completed' });
  });
});
