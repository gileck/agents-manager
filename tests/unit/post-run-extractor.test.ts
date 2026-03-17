import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostRunExtractor, getContextEntryType } from '../../src/core/services/post-run-extractor';
import type { ITaskStore } from '../../src/core/interfaces/task-store';
import type { ITaskContextStore } from '../../src/core/interfaces/task-context-store';
import type { ITaskEventLog } from '../../src/core/interfaces/task-event-log';
import type { INotificationRouter } from '../../src/core/interfaces/notification-router';
import type { Task, AgentRunResult, TaskCreateInput } from '../../src/shared/types';

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: 'Test task',
    description: null,
    status: 'reviewing',
    priority: 0,
    tags: [],
    parentTaskId: null,
    featureId: null,
    assignee: null,
    prLink: null,
    branchName: null,
    plan: null,
    technicalDesign: null,
    debugInfo: null,
    subtasks: [],
    phases: null,
    planComments: [],
    technicalDesignComments: [],
    metadata: {},
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

let taskCounter = 0;

function createMockStores() {
  taskCounter = 0;

  const taskStore: ITaskStore = {
    getTask: vi.fn().mockResolvedValue(createMockTask()),
    listTasks: vi.fn().mockResolvedValue([]),
    createTask: vi.fn().mockImplementation(async (input: TaskCreateInput) => {
      taskCounter++;
      return createMockTask({ ...input, id: `new-task-${taskCounter}`, debugInfo: input.debugInfo ?? null });
    }),
    updateTask: vi.fn().mockResolvedValue(createMockTask()),
    deleteTask: vi.fn().mockResolvedValue(true),
    resetTask: vi.fn().mockResolvedValue(createMockTask()),
    addDependency: vi.fn().mockResolvedValue(undefined),
    removeDependency: vi.fn().mockResolvedValue(undefined),
    getDependencies: vi.fn().mockResolvedValue([]),
    getDependents: vi.fn().mockResolvedValue([]),
    getStatusCounts: vi.fn().mockResolvedValue([]),
    getTotalCount: vi.fn().mockResolvedValue(0),
  };

  const taskContextStore: ITaskContextStore = {
    addEntry: vi.fn().mockResolvedValue({}),
    getEntriesForTask: vi.fn().mockResolvedValue([]),
    markEntriesAsAddressed: vi.fn().mockResolvedValue(0),
  };

  const taskEventLog: ITaskEventLog = {
    log: vi.fn().mockResolvedValue({}),
    getEvents: vi.fn().mockResolvedValue([]),
  };

  const notificationRouter: INotificationRouter = {
    send: vi.fn().mockResolvedValue(undefined),
  };

  return { taskStore, taskContextStore, taskEventLog, notificationRouter };
}

describe('PostRunExtractor.createSuggestedTasks', () => {
  let extractor: PostRunExtractor;
  let stores: ReturnType<typeof createMockStores>;
  const onLog = vi.fn();

  beforeEach(() => {
    stores = createMockStores();
    extractor = new PostRunExtractor(stores.taskStore, stores.taskContextStore, stores.taskEventLog, stores.notificationRouter);
    onLog.mockClear();
  });

  it('should pass debugInfo through when creating suggested tasks', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'review output',
      outcome: 'review_complete',
      structuredOutput: {
        overallVerdict: 'needs_improvement',
        executionSummary: 'Found issues',
        findings: [],
        promptImprovements: [],
        processImprovements: [],
        tokenCostAnalysis: 'ok',
        suggestedTasks: [
          {
            title: '[Bug] Agent crashes on startup',
            description: '**Where**: agent.ts\n**Problem**: null ref',
            debugInfo: 'Timeline: crash at 10:00\nStack: Error at agent.ts:42',
            priority: 1,
          },
        ],
      },
    };

    await extractor.createSuggestedTasks('task-1', 'task-workflow-reviewer', result, onLog);

    expect(stores.taskStore.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '[Bug] Agent crashes on startup',
        description: '**Where**: agent.ts\n**Problem**: null ref',
        debugInfo: 'Timeline: crash at 10:00\nStack: Error at agent.ts:42',
        priority: 1,
        tags: ['workflow-review'],
      }),
    );
  });

  it('should not include debugInfo when suggested task has no debugInfo', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'review output',
      outcome: 'review_complete',
      structuredOutput: {
        overallVerdict: 'good',
        executionSummary: 'All good',
        findings: [],
        promptImprovements: [],
        processImprovements: [],
        tokenCostAnalysis: 'ok',
        suggestedTasks: [
          {
            title: 'Improve prompt guidance',
            description: '**Where**: prompt.ts\n**Problem**: vague instructions',
            priority: 2,
          },
        ],
      },
    };

    await extractor.createSuggestedTasks('task-1', 'task-workflow-reviewer', result, onLog);

    expect(stores.taskStore.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Improve prompt guidance',
        description: '**Where**: prompt.ts\n**Problem**: vague instructions',
        priority: 2,
      }),
    );
    // debugInfo should be undefined (not included)
    const callArgs = (stores.taskStore.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0] as TaskCreateInput;
    expect(callArgs.debugInfo).toBeUndefined();
  });

  it('should skip non-workflow-reviewer agent types', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
    };

    await extractor.createSuggestedTasks('task-1', 'implementor', result, onLog);
    expect(stores.taskStore.createTask).not.toHaveBeenCalled();
  });

  it('should skip when exit code is non-zero', async () => {
    const result: AgentRunResult = {
      exitCode: 1,
      output: 'error',
      outcome: 'failed',
    };

    await extractor.createSuggestedTasks('task-1', 'task-workflow-reviewer', result, onLog);
    expect(stores.taskStore.createTask).not.toHaveBeenCalled();
  });

  it('should send notification with correct phase button based on startPhase', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'review output',
      outcome: 'review_complete',
      structuredOutput: {
        overallVerdict: 'needs_improvement',
        executionSummary: 'Found issues',
        findings: [],
        promptImprovements: [],
        processImprovements: [],
        tokenCostAnalysis: 'ok',
        suggestedTasks: [
          {
            title: 'Add guard for duplicate spawns',
            description: 'Needs architectural design work',
            priority: 1,
            startPhase: 'designing',
          },
        ],
      },
    };

    await extractor.createSuggestedTasks('task-1', 'task-workflow-reviewer', result, onLog);

    expect(stores.notificationRouter.send).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Workflow Review: New Task',
        body: expect.stringContaining('Add guard for duplicate spawns'),
        actions: expect.arrayContaining([
          expect.objectContaining({ label: '\u{1F3A8} Design', callbackData: expect.stringContaining('|designing') }),
          expect.objectContaining({ label: '\u274C Close' }),
          expect.objectContaining({ label: '\u{1F441}\u{FE0F} View' }),
        ]),
      }),
    );
  });

  it('should default to investigating when startPhase is missing', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'review output',
      outcome: 'review_complete',
      structuredOutput: {
        overallVerdict: 'needs_improvement',
        executionSummary: 'Found issues',
        findings: [],
        promptImprovements: [],
        processImprovements: [],
        tokenCostAnalysis: 'ok',
        suggestedTasks: [
          {
            title: 'Fix race condition',
            description: 'Unclear root cause',
            priority: 0,
          },
        ],
      },
    };

    await extractor.createSuggestedTasks('task-1', 'task-workflow-reviewer', result, onLog);

    expect(stores.notificationRouter.send).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: expect.arrayContaining([
          expect.objectContaining({ label: '\u{1F50D} Investigate', callbackData: expect.stringContaining('|investigating') }),
        ]),
      }),
    );
  });

  it('should create task even when notification throws', async () => {
    (stores.notificationRouter.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Telegram unavailable'));

    const result: AgentRunResult = {
      exitCode: 0,
      output: 'review output',
      outcome: 'review_complete',
      structuredOutput: {
        overallVerdict: 'needs_improvement',
        executionSummary: 'Found issues',
        findings: [],
        promptImprovements: [],
        processImprovements: [],
        tokenCostAnalysis: 'ok',
        suggestedTasks: [
          {
            title: 'Improve timeout handling',
            description: 'Timeout too short',
            priority: 2,
          },
        ],
      },
    };

    await extractor.createSuggestedTasks('task-1', 'task-workflow-reviewer', result, onLog);

    // Task was still created
    expect(stores.taskStore.createTask).toHaveBeenCalledTimes(1);
    // Warning was logged
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('notification failed'));
  });
});

describe('getContextEntryType', () => {
  it('should return review_feedback for reviewer with changes_requested outcome', () => {
    expect(getContextEntryType('reviewer', undefined, 'changes_requested')).toBe('review_feedback');
  });

  it('should return review_feedback for reviewer with non-approved outcome', () => {
    expect(getContextEntryType('reviewer', undefined, 'needs_work')).toBe('review_feedback');
  });

  it('should return review_approved for reviewer with approved outcome', () => {
    expect(getContextEntryType('reviewer', undefined, 'approved')).toBe('review_approved');
  });

  it('should return plan_summary for planner without revision', () => {
    expect(getContextEntryType('planner', undefined)).toBe('plan_summary');
  });

  it('should return plan_revision_summary for planner with changes_requested', () => {
    expect(getContextEntryType('planner', 'changes_requested')).toBe('plan_revision_summary');
  });

  it('should return implementation_summary for implementor without revision', () => {
    expect(getContextEntryType('implementor', undefined)).toBe('implementation_summary');
  });

  it('should return fix_summary for implementor with changes_requested', () => {
    expect(getContextEntryType('implementor', 'changes_requested')).toBe('fix_summary');
  });

  it('should return workflow_review for task-workflow-reviewer', () => {
    expect(getContextEntryType('task-workflow-reviewer')).toBe('workflow_review');
  });
});

describe('PostRunExtractor.saveContextEntry', () => {
  let extractor: PostRunExtractor;
  let stores: ReturnType<typeof createMockStores>;
  const onLog = vi.fn();

  beforeEach(() => {
    stores = createMockStores();
    extractor = new PostRunExtractor(stores.taskStore, stores.taskContextStore, stores.taskEventLog, stores.notificationRouter);
    onLog.mockClear();
  });

  it('should mark implementation_feedback and review_feedback as addressed when implementor finishes changes_requested revision', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Fixed the issues',
      outcome: 'done',
      structuredOutput: { summary: 'Applied fixes for reviewer comments' },
    };

    await extractor.saveContextEntry('task-1', 'run-1', 'implementor', 'changes_requested', result, onLog);

    expect(stores.taskContextStore.markEntriesAsAddressed).toHaveBeenCalledWith(
      'task-1',
      ['implementation_feedback', 'review_feedback'],
      'run-1',
    );
  });

  it('should not mark feedback as addressed for implementor without changes_requested', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Initial implementation',
      outcome: 'done',
      structuredOutput: { summary: 'Implemented feature' },
    };

    await extractor.saveContextEntry('task-1', 'run-1', 'implementor', undefined, result, onLog);

    expect(stores.taskContextStore.markEntriesAsAddressed).not.toHaveBeenCalled();
  });

  it('should not mark feedback as addressed for non-implementor agent types', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Review complete',
      outcome: 'changes_requested',
      structuredOutput: { summary: 'Found issues' },
    };

    await extractor.saveContextEntry('task-1', 'run-1', 'reviewer', undefined, result, onLog);

    expect(stores.taskContextStore.markEntriesAsAddressed).not.toHaveBeenCalled();
  });

  it('should skip context entry when exit code is non-zero', async () => {
    const result: AgentRunResult = {
      exitCode: 1,
      output: 'Error',
      outcome: 'failed',
    };

    await extractor.saveContextEntry('task-1', 'run-1', 'implementor', 'changes_requested', result, onLog);

    expect(stores.taskContextStore.addEntry).not.toHaveBeenCalled();
    expect(stores.taskContextStore.markEntriesAsAddressed).not.toHaveBeenCalled();
  });
});
