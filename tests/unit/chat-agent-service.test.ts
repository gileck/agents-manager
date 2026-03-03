import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ChatAgentService, type RunningAgent } from '../../src/core/services/chat-agent-service';
import type { IChatMessageStore } from '../../src/core/interfaces/chat-message-store';
import type { IChatSessionStore } from '../../src/core/interfaces/chat-session-store';
import type { IProjectStore } from '../../src/core/interfaces/project-store';
import type { ITaskStore } from '../../src/core/interfaces/task-store';
import type { IPipelineStore } from '../../src/core/interfaces/pipeline-store';
import type { AgentLibRegistry } from '../../src/core/services/agent-lib-registry';
import type { IAgentLib } from '../../src/core/interfaces/agent-lib';
import type { ChatSession } from '../../src/core/interfaces/chat-session-store';
import type { Project } from '../../src/shared/types';

// Mock the ESM import function (still needed for summarizeMessages which uses SDK directly)
vi.mock('../../src/core/services/chat-agent-service', async (importOriginal) => {
  const mod = await importOriginal() as Record<string, unknown>;
  return {
    ...mod,
    ChatAgentService: class extends (mod.ChatAgentService as typeof ChatAgentService) {
      protected async loadQuery() {
        // Return a mock query function for summarizeMessages
        return async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'Test response' }] },
          };
          yield {
            type: 'result',
            subtype: 'done',
            usage: { input_tokens: 10, output_tokens: 20 },
          };
        };
      }
    },
  };
});

/**
 * Creates a mock IAgentLib that resolves after a short timer delay.
 * The delay is needed because tests use fake timers — the agent stays
 * "running" until timers are advanced, matching the real async behavior.
 */
function createMockAgentLib(): IAgentLib {
  return {
    name: 'claude-code',
    supportedFeatures: () => ({ images: true, hooks: true, thinking: true }),
    getDefaultModel: () => 'claude-opus-4-6',
    getSupportedModels: () => [{ value: 'claude-opus-4-6', label: 'Claude Opus 4.6' }],
    execute: vi.fn().mockImplementation((_runId, _options, callbacks) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          callbacks.onOutput?.('Test response\n');
          callbacks.onMessage?.({ type: 'assistant_text', text: 'Test response', timestamp: Date.now() });
          resolve({
            exitCode: 0,
            output: 'Test response',
            costInputTokens: 10,
            costOutputTokens: 20,
            model: 'claude-opus-4-6',
          });
        }, 100);
      });
    }),
    stop: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(true),
    getTelemetry: vi.fn().mockReturnValue(null),
  };
}

describe('ChatAgentService', () => {
  let service: ChatAgentService;
  let mockMessageStore: IChatMessageStore;
  let mockSessionStore: IChatSessionStore;
  let mockProjectStore: IProjectStore;
  let mockTaskStore: ITaskStore;
  let mockPipelineStore: IPipelineStore;
  let mockAgentLibRegistry: AgentLibRegistry;

  const mockSession: ChatSession = {
    id: 'session-1',
    projectId: 'project-1',
    scopeType: 'project',
    scopeId: 'project-1',
    name: 'Test Session',
    agentLib: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const mockProject: Project = {
    id: 'project-1',
    name: 'Test Project',
    path: '/test/path',
    repositoryUrl: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isCurrent: true,
  };

  beforeEach(() => {
    vi.useFakeTimers();

    mockMessageStore = {
      addMessage: vi.fn().mockResolvedValue({ id: 'msg-1', sessionId: 'session-1', role: 'user', content: 'Test', createdAt: Date.now() }),
      getMessagesForSession: vi.fn().mockResolvedValue([]),
      clearMessages: vi.fn(),
      replaceAllMessages: vi.fn().mockResolvedValue([]),
      getCostSummary: vi.fn(),
    } as unknown as IChatMessageStore;

    mockSessionStore = {
      getSession: vi.fn().mockResolvedValue(mockSession),
      createSession: vi.fn(),
      listSessionsForProject: vi.fn(),
      updateSession: vi.fn(),
      deleteSession: vi.fn(),
    };

    mockProjectStore = {
      getProject: vi.fn().mockResolvedValue(mockProject),
    } as unknown as IProjectStore;

    mockTaskStore = {
      getTask: vi.fn(),
    } as unknown as ITaskStore;

    mockPipelineStore = {
      getPipeline: vi.fn(),
    } as unknown as IPipelineStore;

    mockAgentLibRegistry = {
      listNames: vi.fn().mockReturnValue(['claude-code']),
      getLib: vi.fn().mockReturnValue(createMockAgentLib()),
    } as unknown as AgentLibRegistry;

    service = new ChatAgentService(
      mockMessageStore, mockSessionStore, mockProjectStore,
      mockTaskStore, mockPipelineStore, mockAgentLibRegistry,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('send', () => {
    it('should send a message with valid session ID', async () => {
      const onEvent = vi.fn();

      const result = await service.send('session-1', 'Test message', { systemPrompt: '', onEvent });

      expect(result.userMessage).toBeDefined();
      expect(result.sessionId).toBe('session-1');
      expect(mockSessionStore.getSession).toHaveBeenCalledWith('session-1');
      expect(mockMessageStore.addMessage).toHaveBeenCalled();
    });

    it('should throw error for non-existent session', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(null);

      await expect(service.send('invalid-session', 'Test message', { systemPrompt: '' }))
        .rejects.toThrow('Session not found');
    });

    it('should throw error if agent already running for session', async () => {
      // Start first agent
      await service.send('session-1', 'First message', { systemPrompt: '' });

      // Try to start another for same session
      await expect(service.send('session-1', 'Second message', { systemPrompt: '' }))
        .rejects.toThrow('An agent is already running for this session');
    });

    it('should allow parallel execution for different sessions', async () => {
      const mockSession2: ChatSession = {
        id: 'session-2',
        projectId: 'project-1',
        scopeType: 'project',
        scopeId: 'project-1',
        name: 'Session 2',
        agentLib: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockSessionStore.getSession = vi.fn()
        .mockImplementation((id: string) => Promise.resolve(
          id === 'session-1' ? mockSession : id === 'session-2' ? mockSession2 : null
        ));

      // Start agents for two different sessions
      const result1 = await service.send('session-1', 'Message 1', { systemPrompt: '' });
      const result2 = await service.send('session-2', 'Message 2', { systemPrompt: '' });

      expect(result1.sessionId).toBe('session-1');
      expect(result2.sessionId).toBe('session-2');
    });
  });

  describe('getRunningAgents', () => {
    it('should return list of running agents', async () => {
      // Start an agent
      await service.send('session-1', 'Test message', { systemPrompt: '' });

      const agents = await service.getRunningAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0]).toMatchObject({
        sessionId: 'session-1',
        sessionName: 'Test Session',
        projectId: 'project-1',
        projectName: 'Test Project',
        status: 'running',
      });
    });

    it('should clean up stale completed agents', async () => {
      // Start an agent
      await service.send('session-1', 'Test message', { systemPrompt: '' });

      // Wait for it to complete
      await vi.runAllTimersAsync();

      // Mark as completed (simulating completion)
      const agents = await service.getRunningAgents();
      if (agents.length > 0) {
        agents[0].status = 'completed';
        agents[0].lastActivity = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
      }

      // Get agents again - should clean up old completed ones
      const currentAgents = await service.getRunningAgents();
      expect(currentAgents.every((a: RunningAgent) =>
        a.status === 'running' || a.lastActivity > Date.now() - 60 * 60 * 1000
      )).toBe(true);
    });

    it('should automatically clean up completed agents after delay', async () => {
      // Start an agent
      await service.send('session-1', 'Test message', { systemPrompt: '' });

      let agents = await service.getRunningAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].status).toBe('running');

      // Let the agent execute complete (mock takes 100ms)
      await vi.advanceTimersByTimeAsync(100);

      // Check agents immediately - should still be there as completed
      agents = await service.getRunningAgents();
      expect(agents).toHaveLength(1);

      // Advance time by 5 seconds (cleanup delay set after execute finishes)
      await vi.advanceTimersByTimeAsync(5000);

      // Now it should be cleaned up
      agents = await service.getRunningAgents();
      expect(agents).toHaveLength(0);
    });
  });

  describe('stop', () => {
    it('should stop running agent for session', async () => {
      await service.send('session-1', 'Test message', { systemPrompt: '' });

      let agents = await service.getRunningAgents();
      expect(agents[0].status).toBe('running');

      service.stop('session-1');

      agents = await service.getRunningAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].status).toBe('failed');
    });

    it('should handle stopping non-existent session gracefully', () => {
      expect(() => service.stop('non-existent')).not.toThrow();
    });
  });

  describe('clearMessages', () => {
    it('should stop agent and clear messages for session', async () => {
      await service.send('session-1', 'Test message', { systemPrompt: '' });
      await service.clearMessages('session-1');

      expect(mockMessageStore.clearMessages).toHaveBeenCalledWith('session-1');

      // Agent should be stopped
      const agents = await service.getRunningAgents();
      expect(agents.every((a: RunningAgent) => a.sessionId !== 'session-1' || a.status !== 'running')).toBe(true);
    });
  });

  describe('summarizeMessages', () => {
    it('should stop agent before summarizing', async () => {
      mockMessageStore.getMessagesForSession = vi.fn().mockResolvedValue([
        { id: '1', sessionId: 'session-1', role: 'user', content: 'Hello', createdAt: 1 },
        { id: '2', sessionId: 'session-1', role: 'assistant', content: 'Hi there', createdAt: 2 },
      ]);

      await service.send('session-1', 'Test', { systemPrompt: '' });

      const summary = await service.summarizeMessages('session-1');

      expect(mockMessageStore.replaceAllMessages).toHaveBeenCalled();
      expect(summary).toBeDefined();
    });
  });
});