import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getContextEntryType } from '../../src/core/agents/post-run-utils';
import { plannerPostRunHandler } from '../../src/core/agents/planner-post-run-handler';
import { investigatorPostRunHandler } from '../../src/core/agents/investigator-post-run-handler';
import { designerPostRunHandler } from '../../src/core/agents/designer-post-run-handler';
import { implementorPostRunHandler } from '../../src/core/agents/implementor-post-run-handler';
import { reviewerPostRunHandler } from '../../src/core/agents/reviewer-post-run-handler';
import { triagerPostRunHandler } from '../../src/core/agents/triager-post-run-handler';
import { taskWorkflowReviewerPostRunHandler } from '../../src/core/agents/task-workflow-reviewer-post-run-handler';
import { postMortemReviewerPostRunHandler } from '../../src/core/agents/post-mortem-reviewer-post-run-handler';
import type { ITaskAPI } from '../../src/core/interfaces/task-api';
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

function createMockTaskApi(taskOverrides: Partial<Task> = {}): ITaskAPI {
  taskCounter = 0;
  return {
    taskId: taskOverrides.id ?? 'task-1',
    upsertDoc: vi.fn().mockResolvedValue(undefined),
    updateTask: vi.fn().mockResolvedValue(undefined),
    getTask: vi.fn().mockResolvedValue(createMockTask(taskOverrides)),
    addContextEntry: vi.fn().mockResolvedValue(undefined),
    markFeedbackAsAddressed: vi.fn().mockResolvedValue(undefined),
    logEvent: vi.fn().mockResolvedValue(undefined),
    sendNotification: vi.fn().mockResolvedValue(undefined),
    sendNotificationForTask: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockImplementation(async (input: TaskCreateInput) => {
      taskCounter++;
      return createMockTask({ ...input, id: `new-task-${taskCounter}`, debugInfo: input.debugInfo ?? null });
    }),
  };
}

describe('taskWorkflowReviewerPostRunHandler (createSuggestedTasks)', () => {
  let taskApi: ITaskAPI;
  const onLog = vi.fn();

  beforeEach(() => {
    taskApi = createMockTaskApi();
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

    await taskWorkflowReviewerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.createTask).toHaveBeenCalledWith(
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

    await taskWorkflowReviewerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Improve prompt guidance',
        description: '**Where**: prompt.ts\n**Problem**: vague instructions',
        priority: 2,
      }),
    );
    // debugInfo should be undefined (not included)
    const callArgs = (taskApi.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0] as TaskCreateInput;
    expect(callArgs.debugInfo).toBeUndefined();
  });

  it('should skip when exit code is non-zero', async () => {
    const result: AgentRunResult = {
      exitCode: 1,
      output: 'error',
      outcome: 'failed',
    };

    await taskWorkflowReviewerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);
    expect(taskApi.createTask).not.toHaveBeenCalled();
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

    await taskWorkflowReviewerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.sendNotificationForTask).toHaveBeenCalledWith(
      expect.any(String),
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

    await taskWorkflowReviewerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.sendNotificationForTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        actions: expect.arrayContaining([
          expect.objectContaining({ label: '\u{1F50D} Investigate', callbackData: expect.stringContaining('|investigating') }),
        ]),
      }),
    );
  });

  it('should create task even when notification throws', async () => {
    (taskApi.sendNotificationForTask as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Telegram unavailable'));

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

    await taskWorkflowReviewerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // Task was still created
    expect(taskApi.createTask).toHaveBeenCalledTimes(1);
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

  it('should return post_mortem for post-mortem-reviewer', () => {
    expect(getContextEntryType('post-mortem-reviewer')).toBe('post_mortem');
  });
});

describe('implementorPostRunHandler (saveContextEntry + feedback addressing)', () => {
  let taskApi: ITaskAPI;
  const onLog = vi.fn();

  beforeEach(() => {
    taskApi = createMockTaskApi();
    onLog.mockClear();
  });

  it('should mark implementation_feedback and review_feedback as addressed when implementor finishes changes_requested revision', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Fixed the issues',
      outcome: 'done',
      structuredOutput: { summary: 'Applied fixes for reviewer comments' },
    };

    await implementorPostRunHandler(taskApi, result, 'run-1', 'changes_requested', onLog);

    expect(taskApi.markFeedbackAsAddressed).toHaveBeenCalledWith(
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

    await implementorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.markFeedbackAsAddressed).not.toHaveBeenCalled();
  });

  it('should skip context entry when exit code is non-zero', async () => {
    const result: AgentRunResult = {
      exitCode: 1,
      output: 'Error',
      outcome: 'failed',
    };

    await implementorPostRunHandler(taskApi, result, 'run-1', 'changes_requested', onLog);

    expect(taskApi.addContextEntry).not.toHaveBeenCalled();
    expect(taskApi.markFeedbackAsAddressed).not.toHaveBeenCalled();
  });
});

describe('reviewerPostRunHandler', () => {
  let taskApi: ITaskAPI;
  const onLog = vi.fn();

  beforeEach(() => {
    taskApi = createMockTaskApi();
    onLog.mockClear();
  });

  it('should not mark feedback as addressed for reviewer (feedback addressing is implementor concern)', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Review complete',
      outcome: 'changes_requested',
      structuredOutput: { summary: 'Found issues' },
    };

    await reviewerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.markFeedbackAsAddressed).not.toHaveBeenCalled();
  });
});

describe('postMortemReviewerPostRunHandler', () => {
  let taskApi: ITaskAPI;
  const onLog = vi.fn();

  beforeEach(() => {
    onLog.mockClear();
  });

  it('should extract post-mortem-reviewer structured output fields into context entry data', async () => {
    taskApi = createMockTaskApi({ tags: ['defective'] });
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

    await postMortemReviewerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.addContextEntry).toHaveBeenCalledWith(
      expect.objectContaining({
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
    taskApi = createMockTaskApi({ tags: ['defective'] });
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

    await postMortemReviewerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // Should save post-mortem data to task field
    expect(taskApi.updateTask).toHaveBeenCalledWith({
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
    expect(taskApi.updateTask).toHaveBeenCalledWith({
      tags: ['defective', 'post-mortem-done'],
    });
  });

  it('should not duplicate post-mortem-done tag if already present', async () => {
    taskApi = createMockTaskApi({ tags: ['defective', 'post-mortem-done'] });
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

    await postMortemReviewerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // updateTask should be called once for postMortem data, but NOT for tags
    // since 'post-mortem-done' already exists
    expect(taskApi.updateTask).toHaveBeenCalledTimes(1);
    expect(taskApi.updateTask).toHaveBeenCalledWith({
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

describe('triagerPostRunHandler', () => {
  let taskApi: ITaskAPI;
  const onLog = vi.fn();

  beforeEach(() => {
    taskApi = createMockTaskApi();
    onLog.mockClear();
  });

  it('should extract triager structured output fields into context entry data', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Triage complete',
      outcome: 'triage_complete',
      structuredOutput: {
        triageSummary: 'Small bug fix in renderer',
        suggestedPhase: 'implementing',
        phaseSkipJustification: 'XS bug — skip investigation and design',
      },
    };

    await triagerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.addContextEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'agent',
        entryType: 'triage_summary',
        data: expect.objectContaining({
          suggestedPhase: 'implementing',
          phaseSkipJustification: 'XS bug — skip investigation and design',
        }),
      }),
    );
  });

  it('should extract triager suggestedPhase closed into context entry data', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Triage complete — task is not relevant',
      outcome: 'triage_complete',
      structuredOutput: {
        triageSummary: 'Task is a duplicate of an already-completed task',
        suggestedPhase: 'closed',
      },
    };

    await triagerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.addContextEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'agent',
        entryType: 'triage_summary',
        data: expect.objectContaining({
          suggestedPhase: 'closed',
        }),
      }),
    );
  });

  it('should extract triager relevanceVerdict into context entry data', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Triage complete',
      outcome: 'triage_complete',
      structuredOutput: {
        triageSummary: 'Feature already implemented in codebase',
        suggestedPhase: 'closed',
        phaseSkipJustification: 'Feature already exists — closing task',
        relevanceVerdict: 'already_exists',
      },
    };

    await triagerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.addContextEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'agent',
        entryType: 'triage_summary',
        data: expect.objectContaining({
          suggestedPhase: 'closed',
          phaseSkipJustification: 'Feature already exists — closing task',
          relevanceVerdict: 'already_exists',
        }),
      }),
    );
  });

  it('should use triageSummary as context entry summary for triager', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'raw output',
      outcome: 'triage_complete',
      structuredOutput: {
        triageSummary: 'Small renderer fix — XS bug',
        suggestedPhase: 'implementing',
      },
    };

    await triagerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.addContextEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: 'Small renderer fix — XS bug',
      }),
    );
  });
});

describe('plannerPostRunHandler (extractPlan)', () => {
  let taskApi: ITaskAPI;
  const onLog = vi.fn();

  beforeEach(() => {
    taskApi = createMockTaskApi();
    onLog.mockClear();
  });

  it('should save plan when planner provides plan in structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        plan: '# Plan\n\nImplementation steps.',
        subtasks: ['Step 1', 'Step 2'],
      },
    };

    await plannerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // updateTask should be called with subtasks
    expect(taskApi.updateTask).toHaveBeenCalledWith({
      subtasks: [
        { name: 'Step 1', status: 'open' },
        { name: 'Step 2', status: 'open' },
      ],
    });
    // Doc should be written via upsertDoc
    expect(taskApi.upsertDoc).toHaveBeenCalledWith(
      'plan',
      '# Plan\n\nImplementation steps.',
      null,
    );
  });

  it('should use plan fallback path for planner when no structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Raw plan output here.',
      outcome: 'done',
    };

    await plannerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // Doc should be written via upsertDoc
    expect(taskApi.upsertDoc).toHaveBeenCalledWith(
      'plan',
      'Raw plan output here.',
      null,
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

    await plannerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.markFeedbackAsAddressed).toHaveBeenCalledWith(
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

    await plannerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.updateTask).not.toHaveBeenCalled();
    expect(taskApi.upsertDoc).not.toHaveBeenCalled();
  });

  it('should upsert plan doc with summary when planner provides structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        plan: '# Plan\n\nImplementation steps.',
        planSummary: 'A three-step plan to fix the issue.',
        subtasks: ['Step 1'],
      },
    };

    await plannerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.upsertDoc).toHaveBeenCalledWith(
      'plan',
      '# Plan\n\nImplementation steps.',
      'A three-step plan to fix the issue.',
    );
  });

  it('should upsert with null summary when no summary is provided', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        plan: '# Plan\n\nContent only.',
      },
    };

    await plannerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.upsertDoc).toHaveBeenCalledWith(
      'plan',
      '# Plan\n\nContent only.',
      null,
    );
  });

  it('should not fail if upsertDoc throws', async () => {
    (taskApi.upsertDoc as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        plan: '# Plan',
        planSummary: 'Summary.',
      },
    };

    // Should not throw — upsertDoc failure is non-fatal
    await expect(plannerPostRunHandler(taskApi, result, 'run-1', undefined, onLog)).resolves.toBeUndefined();

    // Warning should be logged
    expect(onLog).toHaveBeenCalledWith(expect.stringContaining('failed to upsert task doc'));
  });
});

describe('investigatorPostRunHandler', () => {
  let taskApi: ITaskAPI;
  const onLog = vi.fn();

  beforeEach(() => {
    taskApi = createMockTaskApi();
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

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // Doc should be written via upsertDoc
    expect(taskApi.upsertDoc).toHaveBeenCalledWith(
      'investigation_report',
      '# Investigation\n\nFindings here.',
      null,
    );
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

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // Doc should be written via upsertDoc
    expect(taskApi.upsertDoc).toHaveBeenCalledWith(
      'investigation_report',
      '# Investigation via plan field\n\nBackward compat.',
      null,
    );
  });

  it('should upsert investigation_report doc with summary when investigator provides structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        investigationReport: '# Investigation\n\nRoot cause found.',
        investigationSummary: 'Root cause is a race condition in cleanup.',
      },
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.upsertDoc).toHaveBeenCalledWith(
      'investigation_report',
      '# Investigation\n\nRoot cause found.',
      'Root cause is a race condition in cleanup.',
    );
  });

  it('should use investigationReport fallback path for investigator when no structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: 'Raw investigation output here.',
      outcome: 'done',
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // Doc should be written via upsertDoc
    expect(taskApi.upsertDoc).toHaveBeenCalledWith(
      'investigation_report',
      'Raw investigation output here.',
      null,
    );
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

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.markFeedbackAsAddressed).toHaveBeenCalledWith(
      ['investigation_feedback'],
      'run-1',
    );
  });

  it('should skip extraction for non-zero exit code', async () => {
    const result: AgentRunResult = {
      exitCode: 1,
      output: 'error',
      outcome: 'failed',
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.upsertDoc).not.toHaveBeenCalled();
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

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // Investigator ignores phases — updateTask should NOT be called with phases
    // (may be called for estimates but not with phases/subtasks)
    const updateCalls = (taskApi.updateTask as ReturnType<typeof vi.fn>).mock.calls;
    const phaseCall = updateCalls.find((call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>;
      return arg.phases || arg.subtasks;
    });
    expect(phaseCall).toBeUndefined();

    // Doc should be written via upsertDoc
    expect(taskApi.upsertDoc).toHaveBeenCalledWith(
      'investigation_report',
      '# Report',
      null,
    );
  });
});

describe('investigatorPostRunHandler proposedOptions extraction', () => {
  let taskApi: ITaskAPI;
  const onLog = vi.fn();

  beforeEach(() => {
    taskApi = createMockTaskApi();
    onLog.mockClear();
  });

  it('should create fix_options_proposed context entry when investigator output includes proposedOptions', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        investigationReport: '# Report',
        proposedOptions: [
          { id: 'opt-1', label: 'Option A', description: 'First approach', recommended: true },
          { id: 'opt-2', label: 'Option B', description: 'Second approach' },
        ],
      },
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.addContextEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRunId: 'run-1',
        source: 'agent',
        entryType: 'fix_options_proposed',
        summary: '2 fix option(s) proposed',
        data: {
          options: [
            { id: 'opt-1', label: 'Option A', description: 'First approach', recommended: true },
            { id: 'opt-2', label: 'Option B', description: 'Second approach' },
          ],
        },
      }),
    );
  });

  it('should not create fix_options_proposed context entry when proposedOptions is empty', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        investigationReport: '# Report',
        proposedOptions: [],
      },
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // addEntry may be called for other context entries but not for fix_options_proposed
    const addEntryCalls = (taskApi.addContextEntry as ReturnType<typeof vi.fn>).mock.calls;
    const fixOptionsCalls = addEntryCalls.filter(
      (call: unknown[]) => (call[0] as { entryType: string }).entryType === 'fix_options_proposed',
    );
    expect(fixOptionsCalls).toHaveLength(0);
  });

  it('should not create fix_options_proposed context entry when proposedOptions is missing', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        investigationReport: '# Report',
      },
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    const addEntryCalls = (taskApi.addContextEntry as ReturnType<typeof vi.fn>).mock.calls;
    const fixOptionsCalls = addEntryCalls.filter(
      (call: unknown[]) => (call[0] as { entryType: string }).entryType === 'fix_options_proposed',
    );
    expect(fixOptionsCalls).toHaveLength(0);
  });
});

describe('designerPostRunHandler', () => {
  let taskApi: ITaskAPI;
  const onLog = vi.fn();

  beforeEach(() => {
    taskApi = createMockTaskApi();
    onLog.mockClear();
  });

  it('should upsert technical_design doc when designer provides structured output', async () => {
    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'done',
      structuredOutput: {
        technicalDesign: '# Design\n\nArchitecture details.',
        designSummary: 'Three-layer architecture with caching.',
      },
    };

    await designerPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    expect(taskApi.upsertDoc).toHaveBeenCalledWith(
      'technical_design',
      '# Design\n\nArchitecture details.',
      'Three-layer architecture with caching.',
    );
  });
});

describe('investigatorPostRunHandler (linkBugToSourceTasks)', () => {
  let taskApi: ITaskAPI;
  const onLog = vi.fn();

  beforeEach(() => {
    onLog.mockClear();
  });

  it('should link valid source task IDs to bug metadata', async () => {
    taskApi = createMockTaskApi({ id: 'bug-1', projectId: 'proj-1', metadata: {} });

    const result: AgentRunResult = {
      exitCode: 0,
      output: 'investigation output',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Found root cause',
        sourceTaskIds: ['source-1'],
      },
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // Should update bug task metadata with sourceTaskId and sourceTaskIds
    expect(taskApi.updateTask).toHaveBeenCalledWith({
      metadata: {
        sourceTaskId: 'source-1',
        sourceTaskIds: ['source-1'],
      },
    });
  });

  it('should merge with already-linked tasks without duplicating', async () => {
    taskApi = createMockTaskApi({
      id: 'bug-1',
      projectId: 'proj-1',
      metadata: { sourceTaskId: 'existing-1', sourceTaskIds: ['existing-1'] },
    });

    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
        sourceTaskIds: ['existing-1', 'new-1'],
      },
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // Bug metadata should contain both, with original sourceTaskId preserved
    expect(taskApi.updateTask).toHaveBeenCalledWith({
      metadata: {
        sourceTaskId: 'existing-1', // preserved from original
        sourceTaskIds: ['existing-1', 'new-1'], // merged and de-duped
      },
    });
  });

  it('should no-op gracefully when sourceTaskIds is empty', async () => {
    taskApi = createMockTaskApi({ id: 'bug-1' });

    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
        sourceTaskIds: [],
      },
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // Should not call getTask for linking (may be called for other purposes)
    // updateTask should only be called for non-linking purposes (if at all)
    const updateCalls = (taskApi.updateTask as ReturnType<typeof vi.fn>).mock.calls;
    const metadataCalls = updateCalls.filter((call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>;
      return arg.metadata;
    });
    expect(metadataCalls).toHaveLength(0);
  });

  it('should no-op when sourceTaskIds is absent from structured output', async () => {
    taskApi = createMockTaskApi({ id: 'bug-1' });

    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
      },
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    const updateCalls = (taskApi.updateTask as ReturnType<typeof vi.fn>).mock.calls;
    const metadataCalls = updateCalls.filter((call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>;
      return arg.metadata;
    });
    expect(metadataCalls).toHaveLength(0);
  });

  it('should skip for non-zero exit code', async () => {
    taskApi = createMockTaskApi({ id: 'bug-1' });

    const result: AgentRunResult = {
      exitCode: 1,
      output: 'error',
      outcome: 'failed',
      structuredOutput: { sourceTaskIds: ['task-1'] },
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    const updateCalls = (taskApi.updateTask as ReturnType<typeof vi.fn>).mock.calls;
    const metadataCalls = updateCalls.filter((call: unknown[]) => {
      const arg = call[0] as Record<string, unknown>;
      return arg.metadata;
    });
    expect(metadataCalls).toHaveLength(0);
  });

  it('should not overwrite manually-set sourceTaskId when auto-linking', async () => {
    taskApi = createMockTaskApi({
      id: 'bug-1',
      projectId: 'proj-1',
      metadata: { sourceTaskId: 'manual-1', route: '/some-page' },
    });

    const result: AgentRunResult = {
      exitCode: 0,
      output: '',
      outcome: 'investigation_complete',
      structuredOutput: {
        investigationReport: '# Report',
        investigationSummary: 'Summary',
        sourceTaskIds: ['auto-1'],
      },
    };

    await investigatorPostRunHandler(taskApi, result, 'run-1', undefined, onLog);

    // sourceTaskId should be preserved (manual-1), not overwritten
    expect(taskApi.updateTask).toHaveBeenCalledWith({
      metadata: {
        sourceTaskId: 'manual-1', // preserved
        sourceTaskIds: ['manual-1', 'auto-1'], // merged
        route: '/some-page', // other metadata preserved
      },
    });
  });
});

describe('POST_RUN_HANDLERS registry', () => {
  it('should export handlers for all known agent types', async () => {
    const { POST_RUN_HANDLERS } = await import('../../src/core/agents/post-run-handlers');

    const expectedAgentTypes = [
      'planner', 'investigator', 'designer', 'ux-designer',
      'implementor', 'reviewer', 'triager',
      'task-workflow-reviewer', 'post-mortem-reviewer',
    ];

    for (const agentType of expectedAgentTypes) {
      expect(POST_RUN_HANDLERS[agentType]).toBeDefined();
      expect(typeof POST_RUN_HANDLERS[agentType]).toBe('function');
    }
  });
});
