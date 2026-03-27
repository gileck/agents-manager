import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduledAgentService } from '../../src/core/services/scheduled-agent-service';
import type { IAgentRunStore } from '../../src/core/interfaces/agent-run-store';
import type { IAutomatedAgentStore } from '../../src/core/interfaces/automated-agent-store';
import type { IProjectStore } from '../../src/core/interfaces/project-store';
import type { ITaskStore } from '../../src/core/interfaces/task-store';
import type { INotificationRouter } from '../../src/core/interfaces/notification-router';
import type { AgentLibRegistry } from '../../src/core/services/agent-lib-registry';
import type { IAgentLib, AgentLibRunOptions } from '../../src/core/interfaces/agent-lib';
import type { AutomatedAgent } from '../../src/shared/types';

// Suppress app-logger output in tests
vi.mock('../../src/core/services/app-logger', () => ({
  getAppLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    logError: vi.fn(),
  }),
}));

function makeLib(name = 'claude-code'): IAgentLib & { executeCalls: Array<{ runId: string; options: AgentLibRunOptions }> } {
  const executeCalls: Array<{ runId: string; options: AgentLibRunOptions }> = [];
  return {
    name,
    getDefaultModel: vi.fn().mockReturnValue('claude-3-5-sonnet'),
    getSupportedModels: vi.fn().mockReturnValue([]),
    execute: vi.fn(async (runId: string, options: AgentLibRunOptions) => {
      executeCalls.push({ runId, options });
      return { exitCode: 0, output: '{"summary":"done","findings":[],"recommendations":[]}', model: 'test-model' };
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
    getTelemetry: vi.fn().mockReturnValue(null),
    injectMessage: vi.fn().mockReturnValue(false),
    supportedFeatures: vi.fn().mockReturnValue({ images: false, hooks: false, thinking: false, nativeResume: false, streamingInput: false }),
    executeCalls,
  };
}

function makeAgent(overrides: Partial<AutomatedAgent> = {}): AutomatedAgent {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    projectId: 'proj-1',
    promptInstructions: 'Do a thing',
    schedule: { type: 'manual' },
    capabilities: {
      canCreateTasks: false,
      canModifyTasks: false,
      readOnly: false,
      maxActions: 10,
      dryRun: false,
    },
    maxRunDurationMs: 300_000,
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as AutomatedAgent;
}

function makeService(lib: ReturnType<typeof makeLib>) {
  const automatedAgentStore: IAutomatedAgentStore = {
    getAgent: vi.fn(),
    listAgents: vi.fn().mockResolvedValue([]),
    createAgent: vi.fn(),
    updateAgent: vi.fn(),
    deleteAgent: vi.fn(),
    recordRun: vi.fn().mockResolvedValue(undefined),
    getDueAgents: vi.fn().mockResolvedValue([]),
  } as unknown as IAutomatedAgentStore;

  const agentRunStore: IAgentRunStore = {
    createRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' }),
    updateRun: vi.fn().mockResolvedValue(null),
    getRun: vi.fn(),
    getActiveRunForAutomatedAgent: vi.fn().mockResolvedValue(null),
    getRunsForTask: vi.fn(),
    getAllRuns: vi.fn(),
    getActiveRuns: vi.fn().mockResolvedValue([]),
    getRunsForAutomatedAgent: vi.fn().mockResolvedValue([]),
  } as unknown as IAgentRunStore;

  const projectStore: IProjectStore = {
    getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'Test Project', path: '/test/project' }),
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

  const registry = {
    register: vi.fn(),
    getLib: vi.fn().mockReturnValue(lib),
    listNames: vi.fn().mockReturnValue([lib.name]),
    getModelsForLib: vi.fn(),
    getAllModels: vi.fn(),
    getAvailableLibs: vi.fn(),
  } as unknown as AgentLibRegistry;

  return new ScheduledAgentService(
    automatedAgentStore,
    agentRunStore,
    projectStore,
    taskStore,
    registry,
    notificationRouter,
  );
}

describe('ScheduledAgentService — sandbox readOnlyPaths', () => {
  let lib: ReturnType<typeof makeLib>;
  let service: ScheduledAgentService;

  beforeEach(() => {
    lib = makeLib();
    service = makeService(lib);
  });

  it('includes global read-only paths (screenshots, chat-images) for non-readOnly agents', async () => {
    const agent = makeAgent({ capabilities: { canCreateTasks: false, canModifyTasks: false, readOnly: false, maxActions: 10, dryRun: false } });

    await service.triggerRun(agent, 'manual');

    // Wait for background execution to complete
    // triggerRun stores the promise internally; give it a tick to resolve
    await new Promise(r => setTimeout(r, 50));

    expect(lib.executeCalls).toHaveLength(1);
    const opts = lib.executeCalls[0].options;

    // Non-readOnly agent should NOT have project path in readOnlyPaths
    expect(opts.readOnlyPaths).toBeDefined();
    expect(opts.readOnlyPaths!.some(p => p.includes('/test/project'))).toBe(false);

    // But should include global read-only paths
    expect(opts.readOnlyPaths!.some(p => p.includes('screenshots'))).toBe(true);
    expect(opts.readOnlyPaths!.some(p => p.includes('chat-images'))).toBe(true);
  });

  it('includes both project path and global read-only paths for readOnly agents', async () => {
    const agent = makeAgent({ capabilities: { canCreateTasks: false, canModifyTasks: false, readOnly: true, maxActions: 10, dryRun: false } });

    await service.triggerRun(agent, 'manual');
    await new Promise(r => setTimeout(r, 50));

    expect(lib.executeCalls).toHaveLength(1);
    const opts = lib.executeCalls[0].options;

    expect(opts.readOnlyPaths).toBeDefined();
    // readOnly agent should have project path in readOnlyPaths
    expect(opts.readOnlyPaths).toContain('/test/project');

    // And also global read-only paths
    expect(opts.readOnlyPaths!.some(p => p.includes('screenshots'))).toBe(true);
    expect(opts.readOnlyPaths!.some(p => p.includes('chat-images'))).toBe(true);
  });
});
