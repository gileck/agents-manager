import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import { TaskReviewReportBuilder } from '../../src/core/services/task-review-report-builder';
import type { IAgentRunStore } from '../../src/core/interfaces/agent-run-store';
import type { ITaskEventLog } from '../../src/core/interfaces/task-event-log';
import type { ITaskContextStore } from '../../src/core/interfaces/task-context-store';
import type { ITaskArtifactStore } from '../../src/core/interfaces/task-artifact-store';
import type { ITaskStore } from '../../src/core/interfaces/task-store';
import type { TimelineService } from '../../src/core/services/timeline/timeline-service';
import type { AgentRun, Task } from '../../src/shared/types';

vi.mock('fs/promises');

const TASK_ID = 'task-1';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    projectId: 'proj-1',
    pipelineId: 'pipe-1',
    title: 'Test Task',
    description: 'A test task',
    type: 'feature',
    size: null,
    complexity: null,
    status: 'done',
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
    debugInfo: null,
    subtasks: [],
    phases: null,
    planComments: [],
    technicalDesignComments: [],
    metadata: {},
    createdAt: 1000,
    updatedAt: 2000,
    createdBy: null,
    ...overrides,
  } as Task;
}

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    taskId: TASK_ID,
    agentType: 'implementor',
    mode: 'new',
    status: 'completed',
    output: null,
    outcome: 'success',
    payload: {},
    exitCode: 0,
    startedAt: 1000,
    completedAt: 2000,
    costInputTokens: 100,
    costOutputTokens: 50,
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

function buildMocks(agentRuns: AgentRun[], task?: Task) {
  const agentRunStore: IAgentRunStore = {
    createRun: vi.fn(),
    updateRun: vi.fn(),
    getRun: vi.fn(),
    getRunsForTask: vi.fn().mockResolvedValue(agentRuns),
    getActiveRuns: vi.fn(),
    getAllRuns: vi.fn(),
    getRunsForAutomatedAgent: vi.fn(),
    getActiveRunForAutomatedAgent: vi.fn(),
    countFailedRunsSync: vi.fn().mockReturnValue(0),
    countRunningRunsSync: vi.fn().mockReturnValue(0),
  };

  const taskStore: ITaskStore = {
    getTask: vi.fn().mockResolvedValue(task ?? makeTask()),
    listTasks: vi.fn().mockResolvedValue([]),
  } as unknown as ITaskStore;

  const taskEventLog: ITaskEventLog = {
    getEvents: vi.fn().mockResolvedValue([]),
  } as unknown as ITaskEventLog;

  const taskContextStore: ITaskContextStore = {
    getEntriesForTask: vi.fn().mockResolvedValue([]),
  } as unknown as ITaskContextStore;

  const taskArtifactStore: ITaskArtifactStore = {
    getArtifactsForTask: vi.fn().mockResolvedValue([]),
  } as unknown as ITaskArtifactStore;

  const timelineService = {
    getTimeline: vi.fn().mockReturnValue([]),
  } as unknown as TimelineService;

  return { agentRunStore, taskStore, taskEventLog, taskContextStore, taskArtifactStore, timelineService };
}

async function buildAndCapture(agentRuns: AgentRun[], task?: Task): Promise<string> {
  const mocks = buildMocks(agentRuns, task);
  const builder = new TaskReviewReportBuilder(
    mocks.agentRunStore,
    mocks.taskEventLog,
    mocks.taskContextStore,
    mocks.taskArtifactStore,
    mocks.taskStore,
    mocks.timelineService,
  );

  let captured = '';
  vi.mocked(fs.writeFile).mockImplementation(async (_path, data) => {
    captured = data as string;
  });

  await builder.buildReport(TASK_ID, '/tmp/report.txt');
  return captured;
}

function extractLine(report: string, prefix: string): string | undefined {
  return report.split('\n').find(l => l.startsWith(prefix));
}

describe('TaskReviewReportBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Failures vs Interruptions', () => {
    it('counts a genuine failure in Failures, not Interruptions', async () => {
      const runs = [
        makeRun({ id: 'run-fail', status: 'failed', outcome: 'error', sessionId: 'sess-1' }),
      ];

      const report = await buildAndCapture(runs);

      expect(extractLine(report, 'Failures:')).toBe('Failures: 1');
      expect(extractLine(report, 'Interruptions:')).toBe('Interruptions: 0 (0 recovered)');
    });

    it('counts an interrupted run in Interruptions, not Failures', async () => {
      const runs = [
        makeRun({ id: 'run-int', status: 'failed', outcome: 'interrupted', sessionId: 'sess-1' }),
      ];

      const report = await buildAndCapture(runs);

      expect(extractLine(report, 'Failures:')).toBe('Failures: 0');
      expect(extractLine(report, 'Interruptions:')).toBe('Interruptions: 1 (0 recovered)');
    });

    it('marks an interrupted run as recovered when a later run shares the same sessionId', async () => {
      const runs = [
        makeRun({ id: 'run-int', status: 'failed', outcome: 'interrupted', sessionId: 'sess-1' }),
        makeRun({ id: 'run-resumed', status: 'completed', outcome: 'success', sessionId: 'sess-1' }),
      ];

      const report = await buildAndCapture(runs);

      expect(extractLine(report, 'Failures:')).toBe('Failures: 0');
      expect(extractLine(report, 'Interruptions:')).toBe('Interruptions: 1 (1 recovered)');
    });

    it('shows zero failures and zero interruptions when all runs succeed', async () => {
      const runs = [
        makeRun({ id: 'run-ok-1', status: 'completed', outcome: 'success' }),
        makeRun({ id: 'run-ok-2', status: 'completed', outcome: 'success' }),
      ];

      const report = await buildAndCapture(runs);

      expect(extractLine(report, 'Failures:')).toBe('Failures: 0');
      expect(extractLine(report, 'Interruptions:')).toBe('Interruptions: 0 (0 recovered)');
    });

    it('does not count interrupted run with null sessionId as recovered', async () => {
      const runs = [
        makeRun({ id: 'run-int', status: 'failed', outcome: 'interrupted', sessionId: null }),
        makeRun({ id: 'run-next', status: 'completed', outcome: 'success', sessionId: 'sess-2' }),
      ];

      const report = await buildAndCapture(runs);

      expect(extractLine(report, 'Interruptions:')).toBe('Interruptions: 1 (0 recovered)');
    });

    it('handles mixed failures, interruptions, and successful runs', async () => {
      const runs = [
        makeRun({ id: 'run-1', status: 'failed', outcome: 'error', sessionId: 'sess-a' }),
        makeRun({ id: 'run-2', status: 'failed', outcome: 'interrupted', sessionId: 'sess-b' }),
        makeRun({ id: 'run-3', status: 'completed', outcome: 'success', sessionId: 'sess-b' }),
        makeRun({ id: 'run-4', status: 'failed', outcome: 'interrupted', sessionId: 'sess-c' }),
        makeRun({ id: 'run-5', status: 'completed', outcome: 'success', sessionId: 'sess-d' }),
      ];

      const report = await buildAndCapture(runs);

      // 1 genuine failure (run-1)
      expect(extractLine(report, 'Failures:')).toBe('Failures: 1');
      // 2 interruptions (run-2, run-4), 1 recovered (run-2 resumed via sess-b)
      expect(extractLine(report, 'Interruptions:')).toBe('Interruptions: 2 (1 recovered)');
    });
  });
});
