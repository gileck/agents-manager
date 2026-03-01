import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerAgentHandler } from '../../src/core/handlers/agent-handler';
import type { IPipelineEngine } from '../../src/core/interfaces/pipeline-engine';
import type { IWorkflowService } from '../../src/core/interfaces/workflow-service';
import type { ITaskEventLog } from '../../src/core/interfaces/task-event-log';
import type { IAgentRunStore } from '../../src/core/interfaces/agent-run-store';
import type { HookFn, Task, Transition, TransitionContext, AgentRun } from '../../src/shared/types';

// Suppress trySendToRenderer require errors in test
vi.mock('@template/main/core/window', () => ({
  sendToRenderer: vi.fn(),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: 'Test task',
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

describe('registerAgentHandler — inline retry', () => {
  let hookFn: HookFn;
  let workflowService: { startAgent: ReturnType<typeof vi.fn> };
  let taskEventLog: { log: ReturnType<typeof vi.fn>; getEvents: ReturnType<typeof vi.fn> };
  let agentRunStore: {
    getRunsForTask: ReturnType<typeof vi.fn>;
    getActiveRuns: ReturnType<typeof vi.fn>;
    createRun: ReturnType<typeof vi.fn>;
    updateRun: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
    getAllRuns: ReturnType<typeof vi.fn>;
  };

  const transition: Transition = {
    from: 'open',
    to: 'implementing',
    trigger: 'system',
    hooks: [],
  };
  const context: TransitionContext = { trigger: 'system' };
  const params = { mode: 'new', agentType: 'implementor' };

  beforeEach(() => {
    vi.useFakeTimers();

    workflowService = {
      startAgent: vi.fn().mockResolvedValue(makeRun()),
    };

    taskEventLog = {
      log: vi.fn().mockResolvedValue({ id: 'evt-1', taskId: 'task-1', category: 'system', severity: 'error', message: '', data: {}, createdAt: Date.now() }),
      getEvents: vi.fn().mockResolvedValue([]),
    };

    agentRunStore = {
      getRunsForTask: vi.fn().mockResolvedValue([]),
      getActiveRuns: vi.fn().mockResolvedValue([]),
      createRun: vi.fn(),
      updateRun: vi.fn(),
      getRun: vi.fn(),
      getAllRuns: vi.fn(),
    };

    // Capture the hook function registered by registerAgentHandler
    const engine = {
      registerHook: vi.fn((_name: string, fn: HookFn) => { hookFn = fn; }),
    } as unknown as IPipelineEngine;

    registerAgentHandler(engine, {
      workflowService: workflowService as unknown as IWorkflowService,
      taskEventLog: taskEventLog as unknown as ITaskEventLog,
      agentRunStore: agentRunStore as unknown as IAgentRunStore,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not retry when agent is already running after 5s', async () => {
    agentRunStore.getRunsForTask.mockResolvedValue([makeRun({ status: 'running' })]);

    const task = makeTask();
    await hookFn(task, transition, context, params);

    // Advance past the 5s check
    await vi.advanceTimersByTimeAsync(5000);

    // startAgent was called once initially (fire-and-forget), no retry
    expect(workflowService.startAgent).toHaveBeenCalledTimes(1);
    expect(taskEventLog.log).not.toHaveBeenCalled();
  });

  it('retries startAgent once when no running agent found after 5s', async () => {
    // First check: no running agents. After retry: agent is running.
    agentRunStore.getRunsForTask
      .mockResolvedValueOnce([]) // 5s check — no agents
      .mockResolvedValueOnce([makeRun({ status: 'running' })]); // follow-up check — success

    const task = makeTask();
    await hookFn(task, transition, context, params);

    // Advance past the 5s check
    await vi.advanceTimersByTimeAsync(5000);

    // Initial fire-and-forget + retry = 2 calls
    expect(workflowService.startAgent).toHaveBeenCalledTimes(2);

    // Log should include retried flag
    expect(taskEventLog.log).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      category: 'system',
      severity: 'error',
      data: expect.objectContaining({ retried: true }),
    }));

    // Advance past the follow-up 5s check
    await vi.advanceTimersByTimeAsync(5000);

    // Agent is running now, so no "still not running" log
    // The log calls: 1 for "retrying once" = total of 1
    expect(taskEventLog.log).toHaveBeenCalledTimes(1);
  });

  it('logs final failure when agent still not running after retry', async () => {
    // Both checks: no running agents
    agentRunStore.getRunsForTask
      .mockResolvedValueOnce([]) // 5s check
      .mockResolvedValueOnce([]); // follow-up check

    const task = makeTask();
    await hookFn(task, transition, context, params);

    // 5s check + retry
    await vi.advanceTimersByTimeAsync(5000);
    // Follow-up check at +10s
    await vi.advanceTimersByTimeAsync(5000);

    // Should have logged: (1) "retrying once", (2) "still not running after retry"
    expect(taskEventLog.log).toHaveBeenCalledTimes(2);
    expect(taskEventLog.log).toHaveBeenLastCalledWith(expect.objectContaining({
      message: expect.stringContaining('still not running after retry'),
      data: expect.objectContaining({ retried: true, finalCheck: true }),
    }));
  });

  it('logs retry failure and skips follow-up check when retry throws', async () => {
    agentRunStore.getRunsForTask.mockResolvedValue([]); // no agents

    // Initial startAgent succeeds (fire-and-forget), retry throws
    workflowService.startAgent
      .mockResolvedValueOnce(makeRun()) // initial
      .mockRejectedValueOnce(new Error('worktree lock')); // retry

    const task = makeTask();
    await hookFn(task, transition, context, params);

    // 5s check triggers retry which throws
    await vi.advanceTimersByTimeAsync(5000);

    // Logs: (1) "retrying once", (2) "retry also failed"
    expect(taskEventLog.log).toHaveBeenCalledTimes(2);
    expect(taskEventLog.log).toHaveBeenLastCalledWith(expect.objectContaining({
      message: expect.stringContaining('retry also failed'),
      data: expect.objectContaining({ error: 'worktree lock', retried: true }),
    }));

    // Advance further — no follow-up check scheduled (returned early)
    await vi.advanceTimersByTimeAsync(10000);
    // Still only 2 log calls (no follow-up)
    expect(taskEventLog.log).toHaveBeenCalledTimes(2);
  });
});
