import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentSupervisor } from '../../src/main/services/agent-supervisor';
import type { IAgentRunStore } from '../../src/main/interfaces/agent-run-store';
import type { IAgentService } from '../../src/main/interfaces/agent-service';
import type { ITaskEventLog } from '../../src/main/interfaces/task-event-log';
import type { AgentRun } from '../../src/shared/types';

// Mock the `now()` utility so we can control time
vi.mock('../../src/main/stores/utils', () => ({
  now: vi.fn(() => Date.now()),
}));

import { now } from '../../src/main/stores/utils';
const mockedNow = vi.mocked(now);

function makeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-1',
    taskId: 'task-1',
    agentType: 'claude',
    mode: 'implement',
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
    ...overrides,
  };
}

describe('AgentSupervisor', () => {
  let agentRunStore: {
    getActiveRuns: ReturnType<typeof vi.fn>;
    updateRun: ReturnType<typeof vi.fn>;
    createRun: ReturnType<typeof vi.fn>;
    getRun: ReturnType<typeof vi.fn>;
    getRunsForTask: ReturnType<typeof vi.fn>;
    getAllRuns: ReturnType<typeof vi.fn>;
  };
  let agentService: {
    execute: ReturnType<typeof vi.fn>;
    queueMessage: ReturnType<typeof vi.fn>;
    waitForCompletion: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    recoverOrphanedRuns: ReturnType<typeof vi.fn>;
    getActiveRunIds: ReturnType<typeof vi.fn>;
  };
  let taskEventLog: {
    log: ReturnType<typeof vi.fn>;
    getEvents: ReturnType<typeof vi.fn>;
  };
  let supervisor: AgentSupervisor;

  beforeEach(() => {
    vi.useFakeTimers();

    agentRunStore = {
      getActiveRuns: vi.fn().mockResolvedValue([]),
      updateRun: vi.fn().mockResolvedValue(null),
      createRun: vi.fn(),
      getRun: vi.fn(),
      getRunsForTask: vi.fn(),
      getAllRuns: vi.fn(),
    };

    agentService = {
      execute: vi.fn(),
      queueMessage: vi.fn(),
      waitForCompletion: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      recoverOrphanedRuns: vi.fn(),
      getActiveRunIds: vi.fn().mockReturnValue([]),
    };

    taskEventLog = {
      log: vi.fn().mockResolvedValue({ id: 'evt-1', taskId: 'task-1', category: 'agent', severity: 'warning', message: '', data: {}, createdAt: Date.now() }),
      getEvents: vi.fn(),
    };

    // Use a short poll interval and timeout for tests
    supervisor = new AgentSupervisor(
      agentRunStore as unknown as IAgentRunStore,
      agentService as unknown as IAgentService,
      taskEventLog as unknown as ITaskEventLog,
      1000,   // pollIntervalMs
      5000,   // defaultTimeoutMs
    );
  });

  afterEach(() => {
    supervisor.stop();
    vi.useRealTimers();
  });

  describe('ghost run detection', () => {
    it('marks a run as failed when it is in DB but not in agentService active IDs', async () => {
      const ghostRun = makeRun({ id: 'ghost-1', taskId: 'task-1' });
      agentRunStore.getActiveRuns.mockResolvedValue([ghostRun]);
      agentService.getActiveRunIds.mockReturnValue([]); // not active in memory
      mockedNow.mockReturnValue(2000);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(agentRunStore.updateRun).toHaveBeenCalledWith('ghost-1', expect.objectContaining({
        status: 'failed',
        outcome: 'interrupted',
        completedAt: 2000,
      }));

      expect(taskEventLog.log).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-1',
        category: 'agent',
        severity: 'warning',
        message: expect.stringContaining('Ghost run detected'),
      }));
    });

    it('appends ghost run message to existing output', async () => {
      const ghostRun = makeRun({ id: 'ghost-2', output: 'partial work' });
      agentRunStore.getActiveRuns.mockResolvedValue([ghostRun]);
      agentService.getActiveRunIds.mockReturnValue([]);
      mockedNow.mockReturnValue(3000);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(agentRunStore.updateRun).toHaveBeenCalledWith('ghost-2', expect.objectContaining({
        output: 'partial work\n[Detected as ghost run by supervisor]',
      }));
    });
  });

  describe('timeout detection', () => {
    it('marks a run as timed_out when elapsed exceeds defaultTimeoutMs', async () => {
      const longRun = makeRun({ id: 'timeout-1', taskId: 'task-2', startedAt: 1000 });
      agentRunStore.getActiveRuns.mockResolvedValue([longRun]);
      agentService.getActiveRunIds.mockReturnValue(['timeout-1']); // active in memory
      mockedNow.mockReturnValue(7000); // elapsed = 7000 - 1000 = 6000 > 5000

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(agentService.stop).toHaveBeenCalledWith('timeout-1');

      expect(agentRunStore.updateRun).toHaveBeenCalledWith('timeout-1', expect.objectContaining({
        status: 'timed_out',
      }));

      expect(taskEventLog.log).toHaveBeenCalledWith(expect.objectContaining({
        taskId: 'task-2',
        severity: 'warning',
        message: expect.stringContaining('timed out'),
      }));
    });

    it('does not mark a run as timed_out if elapsed is within timeout', async () => {
      const recentRun = makeRun({ id: 'ok-1', startedAt: 1000 });
      agentRunStore.getActiveRuns.mockResolvedValue([recentRun]);
      agentService.getActiveRunIds.mockReturnValue(['ok-1']);
      mockedNow.mockReturnValue(3000); // elapsed = 2000 < 5000

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(agentRunStore.updateRun).not.toHaveBeenCalled();
      expect(agentService.stop).not.toHaveBeenCalled();
    });

    it('handles agentService.stop() throwing when agent already completed', async () => {
      const longRun = makeRun({ id: 'timeout-err', startedAt: 0 });
      agentRunStore.getActiveRuns.mockResolvedValue([longRun]);
      agentService.getActiveRunIds.mockReturnValue(['timeout-err']);
      agentService.stop.mockRejectedValue(new Error('agent already done'));
      mockedNow.mockReturnValue(10000);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      // Should still mark as timed_out despite the stop error
      expect(agentRunStore.updateRun).toHaveBeenCalledWith('timeout-err', expect.objectContaining({
        status: 'timed_out',
      }));
    });
  });

  describe('polling lifecycle', () => {
    it('start() begins polling and stop() ends it', async () => {
      agentRunStore.getActiveRuns.mockResolvedValue([]);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(3000);

      expect(agentRunStore.getActiveRuns).toHaveBeenCalledTimes(3);

      supervisor.stop();
      agentRunStore.getActiveRuns.mockClear();

      await vi.advanceTimersByTimeAsync(3000);
      expect(agentRunStore.getActiveRuns).not.toHaveBeenCalled();
    });

    it('start() is idempotent - calling twice does not create two timers', async () => {
      agentRunStore.getActiveRuns.mockResolvedValue([]);

      supervisor.start();
      supervisor.start(); // second call should be ignored

      await vi.advanceTimersByTimeAsync(1000);
      // Only one poll should have fired (not two)
      expect(agentRunStore.getActiveRuns).toHaveBeenCalledTimes(1);
    });

    it('stop() without start() does not throw', () => {
      expect(() => supervisor.stop()).not.toThrow();
    });
  });

  describe('no active runs', () => {
    it('exits early when getActiveRuns returns empty array', async () => {
      agentRunStore.getActiveRuns.mockResolvedValue([]);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(1000);

      expect(agentService.getActiveRunIds).not.toHaveBeenCalled();
      expect(agentRunStore.updateRun).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('poll errors are caught and do not stop polling', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      agentRunStore.getActiveRuns.mockRejectedValueOnce(new Error('DB down'));
      agentRunStore.getActiveRuns.mockResolvedValue([]);

      supervisor.start();
      await vi.advanceTimersByTimeAsync(2000);

      // Should have attempted a second poll after the first one failed
      expect(agentRunStore.getActiveRuns).toHaveBeenCalledTimes(2);

      consoleSpy.mockRestore();
    });
  });
});
