import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import type { ValidationRunner } from '../../src/core/services/validation-runner';
import type { OutcomeResolver } from '../../src/core/services/outcome-resolver';
import type { ScheduledAgentService } from '../../src/core/services/scheduled-agent-service';
import type { AgentRun } from '../../src/shared/types';

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    taskId: '__auto__:agent-1',
    agentType: 'automated-agent',
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
    automatedAgentId: 'agent-1',
    ...overrides,
  };
}

function makeAgentService(
  agentRunStore: Partial<IAgentRunStore>,
  scheduledAgentService?: Partial<ScheduledAgentService>,
): AgentService {
  const agentFramework: IAgentFramework = {
    registerAgent: vi.fn(),
    getAgent: vi.fn().mockImplementation((type: string) => {
      throw new Error(`Agent type not registered: ${type}`);
    }),
    listAgents: vi.fn().mockReturnValue([]),
    getAvailableAgents: vi.fn().mockResolvedValue([]),
  };

  const taskStore: ITaskStore = {
    getTask: vi.fn().mockResolvedValue(null),
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

  const projectStore: IProjectStore = {
    getProject: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  } as unknown as IProjectStore;

  const taskEventLog: ITaskEventLog = {
    log: vi.fn().mockResolvedValue({}),
    getEvents: vi.fn(),
  } as unknown as ITaskEventLog;

  const taskPhaseStore: ITaskPhaseStore = {
    getActivePhase: vi.fn(),
    createPhase: vi.fn(),
    updatePhase: vi.fn(),
  } as unknown as ITaskPhaseStore;

  const pendingPromptStore: IPendingPromptStore = {
    expirePromptsForRun: vi.fn().mockResolvedValue(undefined),
  } as unknown as IPendingPromptStore;

  const taskContextStore: ITaskContextStore = {
    getEntriesForTask: vi.fn(),
  } as unknown as ITaskContextStore;

  const agentDefinitionStore: IAgentDefinitionStore = {
    getDefinition: vi.fn(),
  } as unknown as IAgentDefinitionStore;

  const notificationRouter: INotificationRouter = {
    send: vi.fn(),
  };

  const validationRunner = {} as ValidationRunner;
  const outcomeResolver = {} as OutcomeResolver;

  return new AgentService(
    agentFramework,
    agentRunStore as IAgentRunStore,
    (_path: string) => ({} as IWorktreeManager),
    taskStore,
    projectStore,
    taskEventLog,
    taskPhaseStore,
    pendingPromptStore,
    (_cwd: string) => ({} as import('../../src/core/interfaces/git-ops').IGitOps),
    taskContextStore,
    agentDefinitionStore,
    undefined, // taskReviewReportBuilder
    notificationRouter,
    validationRunner,
    outcomeResolver,
    scheduledAgentService as ScheduledAgentService,
  );
}

describe('AgentService.stop() — automated-agent delegation', () => {
  let agentRunStore: { getRun: ReturnType<typeof vi.fn>; updateRun: ReturnType<typeof vi.fn> } & Record<string, ReturnType<typeof vi.fn>>;
  let scheduledStop: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    agentRunStore = {
      getRun: vi.fn(),
      updateRun: vi.fn().mockResolvedValue(null),
      createRun: vi.fn(),
      getRunsForTask: vi.fn(),
      getAllRuns: vi.fn(),
      getActiveRuns: vi.fn().mockResolvedValue([]),
      getRunsForAutomatedAgent: vi.fn(),
      getActiveRunForAutomatedAgent: vi.fn(),
    };
    scheduledStop = vi.fn().mockResolvedValue(undefined);
  });

  it('delegates to scheduledAgentService.stop() for automated-agent runs without throwing', async () => {
    const run = makeRun({ id: 'auto-run-1', automatedAgentId: 'agent-1' });
    agentRunStore.getRun.mockResolvedValue(run);

    const scheduledAgentService = { stop: scheduledStop } as unknown as ScheduledAgentService;
    const agentService = makeAgentService(agentRunStore, scheduledAgentService);

    await expect(agentService.stop('auto-run-1')).resolves.toBeUndefined();

    expect(scheduledStop).toHaveBeenCalledWith('auto-run-1');
    // Should NOT call agentFramework.getAgent (which would throw for 'automated-agent')
  });

  it('does NOT call agentFramework.getAgent for automated-agent runs', async () => {
    const run = makeRun({ id: 'auto-run-2', automatedAgentId: 'agent-2' });
    agentRunStore.getRun.mockResolvedValue(run);

    const scheduledAgentService = { stop: scheduledStop } as unknown as ScheduledAgentService;
    const agentService = makeAgentService(agentRunStore, scheduledAgentService);

    // This previously threw: "Agent type not registered: automated-agent"
    await expect(agentService.stop('auto-run-2')).resolves.toBeUndefined();
  });

  it('throws when run is not found', async () => {
    agentRunStore.getRun.mockResolvedValue(null);

    const agentService = makeAgentService(agentRunStore);

    await expect(agentService.stop('nonexistent-run')).rejects.toThrow('Agent run not found: nonexistent-run');
  });

  it('falls through to agentFramework for non-automated runs', async () => {
    const run = makeRun({ id: 'task-run-1', taskId: 'task-1', agentType: 'implementor', automatedAgentId: null });
    agentRunStore.getRun.mockResolvedValue(run);
    agentRunStore.updateRun.mockResolvedValue(null);

    // No scheduledAgentService provided — should try agentFramework.getAgent('implementor')
    // which throws. This confirms the delegation check is conditioned on automatedAgentId.
    const agentService = makeAgentService(agentRunStore, undefined);

    await expect(agentService.stop('task-run-1')).rejects.toThrow('Agent type not registered: implementor');
  });
});
