/**
 * Unit tests for AgentService.findOriginalSessionRun — session selection after task reset.
 *
 * After a task reset, old runs from previous cycles still exist in the DB.
 * findOriginalSessionRun must return the MOST RECENT completed mode='new' run
 * (not the oldest), so revision runs resume the fresh session from the current
 * cycle instead of a stale session from a previous cycle.
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
import type { AgentRun } from '../../src/shared/types';
import type { ValidationRunner } from '../../src/core/services/validation-runner';
import type { OutcomeResolver } from '../../src/core/services/outcome-resolver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    taskId: 'task-1',
    agentType: 'implementor',
    mode: 'new',
    status: 'completed',
    output: null,
    outcome: null,
    payload: {},
    exitCode: null,
    startedAt: Date.now(),
    completedAt: Date.now(),
    costInputTokens: null,
    costOutputTokens: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    totalCostUsd: null,
    prompt: null,
    error: null,
    timeoutMs: null,
    maxTurns: null,
    messageCount: null,
    messages: null,
    automatedAgentId: null,
    model: null,
    engine: null,
    sessionId: null,
    diagnostics: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Service factory (minimal mocks — only enough for private method access)
// ---------------------------------------------------------------------------

function makeService(): AgentService {
  const agentRunStore: IAgentRunStore = {
    createRun: vi.fn(),
    updateRun: vi.fn(),
    getRun: vi.fn(),
    getRunsForTask: vi.fn().mockResolvedValue([]),
    getAllRuns: vi.fn(),
    getActiveRuns: vi.fn(),
    getRunsForAutomatedAgent: vi.fn(),
    getActiveRunForAutomatedAgent: vi.fn(),
  } as unknown as IAgentRunStore;

  const agentFramework: IAgentFramework = {
    resolveAgent: vi.fn(),
    listAgents: vi.fn(),
  } as unknown as IAgentFramework;

  return new AgentService(
    agentRunStore,
    { getTask: vi.fn(), listTasks: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn(), resetTask: vi.fn(), addDependency: vi.fn(), removeDependency: vi.fn() } as unknown as ITaskStore,
    { getProject: vi.fn() } as unknown as IProjectStore,
    { log: vi.fn() } as unknown as ITaskEventLog,
    agentFramework,
    (_path: string) => ({} as IWorktreeManager),
    {} as unknown as ITaskPhaseStore,
    {} as unknown as IPendingPromptStore,
    {} as unknown as ITaskContextStore,
    {} as unknown as IAgentDefinitionStore,
    { notify: vi.fn() } as unknown as INotificationRouter,
    {} as unknown as ValidationRunner,
    {} as unknown as OutcomeResolver,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentService.findOriginalSessionRun', () => {
  // Access the private method for direct testing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callFind = (service: AgentService, runs: AgentRun[], agentType: string) =>
    (service as any).findOriginalSessionRun(runs, agentType);

  it('returns the most recent completed mode=new run (newest-first order)', () => {
    const service = makeService();

    // Runs are ordered newest-first from the store.
    const newestRun = makeRun({ id: 'run-new-2', sessionId: 'session-cycle-2', startedAt: 2000 });
    const oldestRun = makeRun({ id: 'run-new-1', sessionId: 'session-cycle-1', startedAt: 1000 });
    const runs = [newestRun, oldestRun]; // newest first

    const result = callFind(service, runs, 'implementor');
    expect(result).toBe(newestRun);
    expect(result!.sessionId).toBe('session-cycle-2');
  });

  it('skips non-completed runs', () => {
    const service = makeService();

    const runningRun = makeRun({ id: 'run-running', status: 'running', startedAt: 3000 });
    const completedRun = makeRun({ id: 'run-completed', sessionId: 'session-good', startedAt: 2000 });
    const runs = [runningRun, completedRun];

    const result = callFind(service, runs, 'implementor');
    expect(result).toBe(completedRun);
  });

  it('skips revision-mode runs', () => {
    const service = makeService();

    const revisionRun = makeRun({ id: 'run-rev', mode: 'revision', startedAt: 3000 });
    const newRun = makeRun({ id: 'run-new', sessionId: 'session-new', startedAt: 2000 });
    const runs = [revisionRun, newRun];

    const result = callFind(service, runs, 'implementor');
    expect(result).toBe(newRun);
  });

  it('filters by agentType', () => {
    const service = makeService();

    const plannerRun = makeRun({ id: 'run-planner', agentType: 'planner', startedAt: 3000 });
    const implRun = makeRun({ id: 'run-impl', agentType: 'implementor', sessionId: 'session-impl', startedAt: 2000 });
    const runs = [plannerRun, implRun];

    const result = callFind(service, runs, 'implementor');
    expect(result).toBe(implRun);
  });

  it('returns undefined when no matching run exists', () => {
    const service = makeService();

    const failedRun = makeRun({ id: 'run-failed', status: 'failed', startedAt: 2000 });
    const runs = [failedRun];

    const result = callFind(service, runs, 'implementor');
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty runs array', () => {
    const service = makeService();

    const result = callFind(service, [], 'implementor');
    expect(result).toBeUndefined();
  });

  it('after task reset, picks the fresh cycle session — not the stale one', () => {
    const service = makeService();

    // Simulate post-reset scenario: old cycle runs + new cycle run.
    // Store returns newest-first.
    const freshCycleRun = makeRun({
      id: 'run-cycle2',
      sessionId: 'session-fresh',
      startedAt: 5000,
    });
    const staleCycleRun = makeRun({
      id: 'run-cycle1',
      sessionId: 'session-stale',
      startedAt: 1000,
    });
    // Also include a revision from the old cycle
    const oldRevision = makeRun({
      id: 'run-rev-old',
      mode: 'revision',
      sessionId: 'session-stale',
      startedAt: 2000,
    });

    // Newest first: fresh cycle → old revision → stale cycle
    const runs = [freshCycleRun, oldRevision, staleCycleRun];

    const result = callFind(service, runs, 'implementor');
    expect(result).toBe(freshCycleRun);
    expect(result!.sessionId).toBe('session-fresh');
  });
});
