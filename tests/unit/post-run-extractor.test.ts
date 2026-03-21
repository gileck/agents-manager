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
    investigationReport: null,
    technicalDesign: null,
    postMortem: null,
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

  it('should not auto-create tasks for post-mortem-reviewer (disabled)', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'post-mortem output',
      outcome: 'review_complete',
      structuredOutput: {
        rootCause: 'design_flaw',
        severity: 'major',
        responsibleAgents: ['planner'],
        analysis: 'Missed edge case in sorting',
        codebaseImprovements: [],
        suggestedTasks: [
          {
            title: 'Consolidate sorting validation into shared utility',
            description: '**Where**: planner-prompt-builder.ts\n**Problem**: No edge case guidance',
            priority: 1,
            startPhase: 'planning',
          },
        ],
      },
    };

    await extractor.createSuggestedTasks('task-1', 'post-mortem-reviewer', result, onLog);

    // Auto-creation is disabled for post-mortem-reviewer — tasks are presented for user review instead
    expect(stores.taskStore.createTask).not.toHaveBeenCalled();
    expect(stores.notificationRouter.send).not.toHaveBeenCalled();
  });

  it('should skip post-mortem-reviewer suggested tasks (auto-creation disabled)', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'output',
      outcome: 'review_complete',
      structuredOutput: {
        suggestedTasks: [
          { title: 'Add type safety for sorting enums', description: 'Add checklist', priority: 2 },
        ],
      },
    };

    await extractor.createSuggestedTasks('task-1', 'post-mortem-reviewer', result, onLog);
    expect(stores.taskStore.createTask).not.toHaveBeenCalled();
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

  it('should return post_mortem for post-mortem-reviewer', () => {
    expect(getContextEntryType('post-mortem-reviewer')).toBe('post_mortem');
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

  it('should extract post-mortem-reviewer structured output fields into context entry data', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Post-mortem analysis complete',
      outcome: 'review_complete',
      structuredOutput: {
        rootCause: 'design_flaw',
        severity: 'major',
        responsibleAgents: ['planner', 'reviewer'],
        analysis: 'The planner missed an edge case in the sorting logic.',
        codebaseImprovements: ['Consolidate sorting validation into a shared utility with exhaustive enum checks'],
        suggestedTasks: [{ title: 'Add type-safe sorting enum', description: 'Introduce shared enum for sort fields' }],
      },
    };

    (stores.taskStore.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(createMockTask({ tags: ['defective'] }));

    await extractor.saveContextEntry('task-1', 'run-1', 'post-mortem-reviewer', undefined, result, onLog);

    expect(stores.taskContextStore.addEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-1',
        source: 'post-mortem-reviewer',
        entryType: 'post_mortem',
        data: expect.objectContaining({
          rootCause: 'design_flaw',
          severity: 'major',
          responsibleAgents: ['planner', 'reviewer'],
          analysis: 'The planner missed an edge case in the sorting logic.',
          codebaseImprovements: ['Consolidate sorting validation into a shared utility with exhaustive enum checks'],
          suggestedTasks: [{ title: 'Add type-safe sorting enum', description: 'Introduce shared enum for sort fields' }],
        }),
      }),
    );
  });

  it('should add post-mortem-done tag when post-mortem-reviewer context entry is saved', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Post-mortem analysis complete',
      outcome: 'review_complete',
      structuredOutput: {
        rootCause: 'missed_edge_case',
        severity: 'minor',
        responsibleAgents: ['implementor'],
        analysis: 'Minor edge case missed.',
        codebaseImprovements: [],
        suggestedTasks: [],
      },
    };

    (stores.taskStore.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(createMockTask({ tags: ['defective'] }));

    await extractor.saveContextEntry('task-1', 'run-1', 'post-mortem-reviewer', undefined, result, onLog);

    // Should save post-mortem data to task field
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('task-1', {
      postMortem: {
        rootCause: 'missed_edge_case',
        severity: 'minor',
        responsibleAgents: ['implementor'],
        analysis: 'Minor edge case missed.',
        codebaseImprovements: [],
        suggestedTasks: [],
      },
    });
    // Should add post-mortem-done tag
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('task-1', {
      tags: ['defective', 'post-mortem-done'],
    });
  });

  it('should not duplicate post-mortem-done tag if already present', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Post-mortem analysis complete',
      outcome: 'review_complete',
      structuredOutput: {
        rootCause: 'other',
        severity: 'minor',
        responsibleAgents: [],
        analysis: 'Unknown cause.',
        codebaseImprovements: [],
        suggestedTasks: [],
      },
    };

    (stores.taskStore.getTask as ReturnType<typeof vi.fn>).mockResolvedValue(
      createMockTask({ tags: ['defective', 'post-mortem-done'] }),
    );

    await extractor.saveContextEntry('task-1', 'run-1', 'post-mortem-reviewer', undefined, result, onLog);

    // updateTask should be called once for postMortem data, but NOT for tags
    // since 'post-mortem-done' already exists
    expect(stores.taskStore.updateTask).toHaveBeenCalledTimes(1);
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('task-1', {
      postMortem: {
        rootCause: 'other',
        severity: 'minor',
        responsibleAgents: [],
        analysis: 'Unknown cause.',
        codebaseImprovements: [],
        suggestedTasks: [],
      },
    });
  });
});

describe('PostRunExtractor.extractPlan', () => {
  let extractor: PostRunExtractor;
  let stores: ReturnType<typeof createMockStores>;
  const onLog = vi.fn();

  beforeEach(() => {
    stores = createMockStores();
    extractor = new PostRunExtractor(stores.taskStore, stores.taskContextStore, stores.taskEventLog, stores.notificationRouter);
    onLog.mockClear();
  });

  it('should save investigationReport when investigator provides investigationReport in structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        investigationReport: '# Investigation\n\nFindings here.',
      },
    };

    await extractor.extractPlan('task-1', result, 'investigator', onLog);

    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('task-1', {
      investigationReport: '# Investigation\n\nFindings here.',
    });
  });

  it('should save investigationReport when investigator provides plan in structured output (backward compat)', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        plan: '# Investigation via plan field\n\nBackward compat.',
      },
    };

    await extractor.extractPlan('task-1', result, 'investigator', onLog);

    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('task-1', {
      investigationReport: '# Investigation via plan field\n\nBackward compat.',
    });
  });

  it('should save plan (not investigationReport) when planner provides plan in structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        plan: '# Plan\n\nImplementation steps.',
        subtasks: ['Step 1', 'Step 2'],
      },
    };

    await extractor.extractPlan('task-1', result, 'planner', onLog);

    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      plan: '# Plan\n\nImplementation steps.',
    }));
    // Should NOT have set investigationReport
    const updateCall = (stores.taskStore.updateTask as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(updateCall).not.toHaveProperty('investigationReport');
  });

  it('should use investigationReport fallback path for investigator when no structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Raw investigation output here.',
      outcome: 'done',
    };

    await extractor.extractPlan('task-1', result, 'investigator', onLog);

    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('task-1', {
      investigationReport: 'Raw investigation output here.',
    });
  });

  it('should use plan fallback path for planner when no structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Raw plan output here.',
      outcome: 'done',
    };

    await extractor.extractPlan('task-1', result, 'planner', onLog);

    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('task-1', {
      plan: 'Raw plan output here.',
    });
  });

  it('should mark investigation_feedback as addressed after investigator run', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        investigationReport: '# Report',
      },
    };

    await extractor.extractPlan('task-1', result, 'investigator', onLog, undefined, 'run-1');

    expect(stores.taskContextStore.markEntriesAsAddressed).toHaveBeenCalledWith(
      'task-1',
      ['investigation_feedback'],
      'run-1',
    );
  });

  it('should mark plan_feedback as addressed after planner run', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        plan: '# Plan',
      },
    };

    await extractor.extractPlan('task-1', result, 'planner', onLog, undefined, 'run-1');

    expect(stores.taskContextStore.markEntriesAsAddressed).toHaveBeenCalledWith(
      'task-1',
      ['plan_feedback'],
      'run-1',
    );
  });

  it('should skip extraction for non-zero exit code', async () => {
    const result: AgentRunResult = {
      exitCode: 1,
      output: 'error',
      outcome: 'failed',
    };

    await extractor.extractPlan('task-1', result, 'investigator', onLog);

    expect(stores.taskStore.updateTask).not.toHaveBeenCalled();
  });

  it('should skip extraction for non-planner/investigator agent types', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: { plan: '# Plan' },
    };

    await extractor.extractPlan('task-1', result, 'implementor', onLog);

    expect(stores.taskStore.updateTask).not.toHaveBeenCalled();
  });

  it('should not create multi-phase output for investigator even when phases are provided', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        investigationReport: '# Report',
        phases: [
          { name: 'Phase 1', subtasks: ['A'] },
          { name: 'Phase 2', subtasks: ['B'] },
        ],
      },
    };

    await extractor.extractPlan('task-1', result, 'investigator', onLog);

    const updateCall = (stores.taskStore.updateTask as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(updateCall).toEqual({ investigationReport: '# Report' });
    expect(updateCall).not.toHaveProperty('phases');
  });
});

describe('PostRunExtractor.linkBugToSourceTasks', () => {
  let extractor: PostRunExtractor;
  let stores: ReturnType<typeof createMockStores>;
  const onLog = vi.fn();

  beforeEach(() => {
    stores = createMockStores();
    extractor = new PostRunExtractor(stores.taskStore, stores.taskContextStore, stores.taskEventLog, stores.notificationRouter);
    onLog.mockClear();
  });

  it('should link valid source task IDs and add defective tag', async () => {
    const bugTask = createMockTask({ id: 'bug-1', projectId: 'proj-1', type: 'bug' as Task['type'], metadata: {} });
    const sourceTask = createMockTask({ id: 'source-1', projectId: 'proj-1', tags: ['feature'] });

    (stores.taskStore.getTask as ReturnType<typeof vi.fn>)
      .mockImplementation(async (id: string) => {
        if (id === 'bug-1') return bugTask;
        if (id === 'source-1') return sourceTask;
        return null;
      });

    const result: AgentRunResult = {
      exitCode: 0,
      output: 'investigation output',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Found root cause',
        subtasks: ['Fix it'],
        sourceTaskIds: ['source-1'],
      },
    };

    await extractor.linkBugToSourceTasks('bug-1', result, 'investigator', onLog);

    // Should add defective tag to source task
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('source-1', {
      tags: ['feature', 'defective'],
    });

    // Should update bug task metadata with sourceTaskId and sourceTaskIds
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('bug-1', {
      metadata: {
        sourceTaskId: 'source-1',
        sourceTaskIds: ['source-1'],
      },
    });

    // Should log events
    expect(stores.taskEventLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'source-1',
        category: 'agent',
        severity: 'info',
        message: expect.stringContaining('marked as defective'),
      }),
    );
    expect(stores.taskEventLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'bug-1',
        category: 'agent',
        severity: 'info',
        message: expect.stringContaining('Auto-linked bug'),
      }),
    );
  });

  it('should skip invalid task IDs that do not exist', async () => {
    const bugTask = createMockTask({ id: 'bug-1', projectId: 'proj-1', metadata: {} });

    (stores.taskStore.getTask as ReturnType<typeof vi.fn>)
      .mockImplementation(async (id: string) => {
        if (id === 'bug-1') return bugTask;
        return null; // source task not found
      });

    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
        subtasks: [],
        sourceTaskIds: ['nonexistent-task'],
      },
    };

    await extractor.linkBugToSourceTasks('bug-1', result, 'investigator', onLog);

    // Should log a warning about the invalid ID
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('not found'));

    // Should NOT update bug task metadata (no valid IDs)
    expect(stores.taskStore.updateTask).not.toHaveBeenCalledWith('bug-1', expect.anything());
  });

  it('should merge with already-linked tasks without duplicating', async () => {
    const bugTask = createMockTask({
      id: 'bug-1',
      projectId: 'proj-1',
      metadata: { sourceTaskId: 'existing-1', sourceTaskIds: ['existing-1'] },
    });
    const existingSource = createMockTask({ id: 'existing-1', projectId: 'proj-1', tags: ['defective'] });
    const newSource = createMockTask({ id: 'new-1', projectId: 'proj-1', tags: [] });

    (stores.taskStore.getTask as ReturnType<typeof vi.fn>)
      .mockImplementation(async (id: string) => {
        if (id === 'bug-1') return bugTask;
        if (id === 'existing-1') return existingSource;
        if (id === 'new-1') return newSource;
        return null;
      });

    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
        subtasks: [],
        sourceTaskIds: ['existing-1', 'new-1'],
      },
    };

    await extractor.linkBugToSourceTasks('bug-1', result, 'investigator', onLog);

    // Should add defective tag to new source only (existing already has it)
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('new-1', {
      tags: ['defective'],
    });

    // Should NOT add defective tag to existing source (already tagged)
    expect(stores.taskStore.updateTask).not.toHaveBeenCalledWith('existing-1', expect.anything());

    // Bug metadata should contain both, with original sourceTaskId preserved
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('bug-1', {
      metadata: {
        sourceTaskId: 'existing-1', // preserved from original
        sourceTaskIds: ['existing-1', 'new-1'], // merged and de-duped
      },
    });
  });

  it('should no-op gracefully when sourceTaskIds is empty', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
        subtasks: [],
        sourceTaskIds: [],
      },
    };

    await extractor.linkBugToSourceTasks('bug-1', result, 'investigator', onLog);

    // Should not call getTask or updateTask
    expect(stores.taskStore.getTask).not.toHaveBeenCalled();
    expect(stores.taskStore.updateTask).not.toHaveBeenCalled();
  });

  it('should no-op when sourceTaskIds is absent from structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
        subtasks: [],
      },
    };

    await extractor.linkBugToSourceTasks('bug-1', result, 'investigator', onLog);

    expect(stores.taskStore.getTask).not.toHaveBeenCalled();
    expect(stores.taskStore.updateTask).not.toHaveBeenCalled();
  });

  it('should skip for non-investigator agent types', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: { sourceTaskIds: ['task-1'] },
    };

    await extractor.linkBugToSourceTasks('bug-1', result, 'planner', onLog);

    expect(stores.taskStore.getTask).not.toHaveBeenCalled();
    expect(stores.taskStore.updateTask).not.toHaveBeenCalled();
  });

  it('should skip for non-zero exit code', async () => {
    const result: AgentRunResult = {
      exitCode: 1,
      output: 'error',
      outcome: 'failed',
      structuredOutput: { sourceTaskIds: ['task-1'] },
    };

    await extractor.linkBugToSourceTasks('bug-1', result, 'investigator', onLog);

    expect(stores.taskStore.getTask).not.toHaveBeenCalled();
    expect(stores.taskStore.updateTask).not.toHaveBeenCalled();
  });

  it('should skip source tasks from a different project', async () => {
    const bugTask = createMockTask({ id: 'bug-1', projectId: 'proj-1', metadata: {} });
    const crossProjectTask = createMockTask({ id: 'cross-1', projectId: 'proj-other', tags: [] });

    (stores.taskStore.getTask as ReturnType<typeof vi.fn>)
      .mockImplementation(async (id: string) => {
        if (id === 'bug-1') return bugTask;
        if (id === 'cross-1') return crossProjectTask;
        return null;
      });

    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
        subtasks: [],
        sourceTaskIds: ['cross-1'],
      },
    };

    await extractor.linkBugToSourceTasks('bug-1', result, 'investigator', onLog);

    // Should log warning about cross-project
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('different project'));

    // Should NOT update bug task metadata (no valid IDs after filtering)
    expect(stores.taskStore.updateTask).not.toHaveBeenCalledWith('bug-1', expect.anything());
  });

  it('should handle multiple valid source tasks', async () => {
    const bugTask = createMockTask({ id: 'bug-1', projectId: 'proj-1', metadata: {} });
    const source1 = createMockTask({ id: 'src-1', projectId: 'proj-1', tags: [] });
    const source2 = createMockTask({ id: 'src-2', projectId: 'proj-1', tags: ['existing-tag'] });

    (stores.taskStore.getTask as ReturnType<typeof vi.fn>)
      .mockImplementation(async (id: string) => {
        if (id === 'bug-1') return bugTask;
        if (id === 'src-1') return source1;
        if (id === 'src-2') return source2;
        return null;
      });

    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
        subtasks: [],
        sourceTaskIds: ['src-1', 'src-2'],
      },
    };

    await extractor.linkBugToSourceTasks('bug-1', result, 'investigator', onLog);

    // Both source tasks should get defective tag
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('src-1', { tags: ['defective'] });
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('src-2', { tags: ['existing-tag', 'defective'] });

    // Bug task metadata should have first ID as sourceTaskId and full array
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('bug-1', {
      metadata: {
        sourceTaskId: 'src-1',
        sourceTaskIds: ['src-1', 'src-2'],
      },
    });
  });

  it('should not overwrite manually-set sourceTaskId when auto-linking', async () => {
    const bugTask = createMockTask({
      id: 'bug-1',
      projectId: 'proj-1',
      metadata: { sourceTaskId: 'manual-1', route: '/some-page' },
    });
    const manualSource = createMockTask({ id: 'manual-1', projectId: 'proj-1', tags: ['defective'] });
    const autoSource = createMockTask({ id: 'auto-1', projectId: 'proj-1', tags: [] });

    (stores.taskStore.getTask as ReturnType<typeof vi.fn>)
      .mockImplementation(async (id: string) => {
        if (id === 'bug-1') return bugTask;
        if (id === 'manual-1') return manualSource;
        if (id === 'auto-1') return autoSource;
        return null;
      });

    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
        subtasks: [],
        sourceTaskIds: ['auto-1'],
      },
    };

    await extractor.linkBugToSourceTasks('bug-1', result, 'investigator', onLog);

    // sourceTaskId should be preserved (manual-1), not overwritten
    expect(stores.taskStore.updateTask).toHaveBeenCalledWith('bug-1', {
      metadata: {
        sourceTaskId: 'manual-1', // preserved
        sourceTaskIds: ['manual-1', 'auto-1'], // merged
        route: '/some-page', // other metadata preserved
      },
    });
  });
});
