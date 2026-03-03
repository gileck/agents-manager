import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduledAgentService } from '../../src/core/services/scheduled-agent-service';
import type { IAgentRunStore } from '../../src/core/interfaces/agent-run-store';
import type { IAutomatedAgentStore } from '../../src/core/interfaces/automated-agent-store';
import type { IProjectStore } from '../../src/core/interfaces/project-store';
import type { ITaskStore } from '../../src/core/interfaces/task-store';
import type { INotificationRouter } from '../../src/core/interfaces/notification-router';
import type { AgentLibRegistry } from '../../src/core/services/agent-lib-registry';
import type { IAgentLib } from '../../src/core/interfaces/agent-lib';

function makeLib(name = 'claude-code'): IAgentLib & { stop: ReturnType<typeof vi.fn> } {
  return {
    name,
    getDefaultModel: vi.fn().mockReturnValue('claude-3-5-sonnet'),
    getSupportedModels: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({ exitCode: 0, output: '' }),
    stop: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
    getTelemetry: vi.fn().mockReturnValue(null),
  };
}

function makeAgentRunStore(): Pick<IAgentRunStore, 'updateRun' | 'getRun' | 'getActiveRunForAutomatedAgent'> & Record<string, ReturnType<typeof vi.fn>> {
  return {
    updateRun: vi.fn().mockResolvedValue(null),
    getRun: vi.fn(),
    getActiveRunForAutomatedAgent: vi.fn().mockResolvedValue(null),
    createRun: vi.fn(),
    getRunsForTask: vi.fn(),
    getAllRuns: vi.fn(),
    getActiveRuns: vi.fn().mockResolvedValue([]),
    getRunsForAutomatedAgent: vi.fn().mockResolvedValue([]),
  };
}

function makeRegistry(lib: IAgentLib): AgentLibRegistry {
  return {
    register: vi.fn(),
    getLib: vi.fn().mockReturnValue(lib),
    listNames: vi.fn().mockReturnValue([lib.name]),
    getModelsForLib: vi.fn(),
    getAllModels: vi.fn(),
    getAvailableLibs: vi.fn(),
  } as unknown as AgentLibRegistry;
}

function makeService(lib: IAgentLib, agentRunStore: ReturnType<typeof makeAgentRunStore>): ScheduledAgentService {
  const automatedAgentStore: IAutomatedAgentStore = {
    getAgent: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    recordRun: vi.fn().mockResolvedValue(undefined),
    getDueAgents: vi.fn().mockResolvedValue([]),
  } as unknown as IAutomatedAgentStore;

  const projectStore: IProjectStore = {
    getProject: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn(),
  } as unknown as IProjectStore;

  const taskStore: ITaskStore = {
    listTasks: vi.fn().mockResolvedValue([]),
  } as unknown as ITaskStore;

  const notificationRouter: INotificationRouter = {
    send: vi.fn().mockResolvedValue(undefined),
  };

  return new ScheduledAgentService(
    automatedAgentStore,
    agentRunStore as unknown as IAgentRunStore,
    projectStore,
    taskStore,
    makeRegistry(lib),
    notificationRouter,
  );
}

describe('ScheduledAgentService.stop()', () => {
  let lib: ReturnType<typeof makeLib>;
  let agentRunStore: ReturnType<typeof makeAgentRunStore>;
  let service: ScheduledAgentService;

  beforeEach(() => {
    lib = makeLib();
    agentRunStore = makeAgentRunStore();
    service = makeService(lib, agentRunStore);
  });

  it('calls lib.stop(runId) and marks run as cancelled when run is active', async () => {
    // Simulate an active run by injecting into private maps via triggerRun side-effects.
    // We expose the internal maps indirectly by testing through the public contract.
    // Since we cannot easily call triggerRun (it needs a real project/agent/etc.),
    // we access the private maps directly for test purposes using type assertion.
    const svc = service as unknown as {
      activeRunLibs: Map<string, string>;
    };

    svc.activeRunLibs.set('run-123', 'claude-code');

    await service.stop('run-123');

    expect(lib.stop).toHaveBeenCalledWith('run-123');
    expect(agentRunStore.updateRun).toHaveBeenCalledWith('run-123', expect.objectContaining({
      status: 'cancelled',
      completedAt: expect.any(Number),
    }));

    // Should have been cleaned up from internal tracking
    expect(svc.activeRunLibs.has('run-123')).toBe(false);
  });

  it('returns without throwing when run is not tracked (already completed or unknown)', async () => {
    await expect(service.stop('unknown-run-id')).resolves.toBeUndefined();

    expect(lib.stop).not.toHaveBeenCalled();
    expect(agentRunStore.updateRun).not.toHaveBeenCalled();
  });

  it('calls lib.stop() with the correct runId when multiple runs are active', async () => {
    const svc = service as unknown as {
      activeRunLibs: Map<string, string>;
    };

    svc.activeRunLibs.set('run-A', 'claude-code');
    svc.activeRunLibs.set('run-B', 'claude-code');

    await service.stop('run-A');

    expect(lib.stop).toHaveBeenCalledOnce();
    expect(lib.stop).toHaveBeenCalledWith('run-A');

    // run-B should still be tracked
    expect(svc.activeRunLibs.has('run-B')).toBe(true);
  });
});
