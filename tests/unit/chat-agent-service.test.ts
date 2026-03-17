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
import type { AgentChatMessage, Project } from '../../src/shared/types';

vi.mock('../../src/core/mcp/task-mcp-server', () => ({
  createTaskMcpServer: vi.fn().mockResolvedValue([]),
}));

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
    supportedFeatures: () => ({ images: true, hooks: true, thinking: true, nativeResume: true }),
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

    it('passes danger-full-access Codex sandbox mode for full_access sessions', async () => {
      const execute = vi.fn().mockResolvedValue({
        exitCode: 0,
        output: 'ok',
        model: 'gpt-5.4',
      });

      mockSessionStore.getSession = vi.fn().mockResolvedValue({
        ...mockSession,
        agentLib: 'codex-app-server',
      });
      mockAgentLibRegistry.listNames = vi.fn().mockReturnValue(['claude-code', 'codex-app-server']);
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue({
        name: 'codex-app-server',
        supportedFeatures: () => ({ images: true, hooks: false, thinking: true, nativeResume: true }),
        getDefaultModel: () => 'gpt-5.4',
        getSupportedModels: () => [{ value: 'gpt-5.4', label: 'GPT-5.4' }],
        execute,
        stop: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getTelemetry: vi.fn().mockReturnValue(null),
      } satisfies IAgentLib);

      await service.send('session-1', 'Test message', { systemPrompt: '', permissionMode: 'full_access' });
      await vi.advanceTimersByTimeAsync(0);

      expect(execute).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          permissionMode: 'full_access',
          readOnly: false,
        }),
        expect.any(Object),
      );
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

  describe('client tool calls', () => {
    it('emits tagged nested subagent messages for Task tool delegation', async () => {
      const execute = vi.fn().mockImplementation(async (runId: string, _options, callbacks) => {
        if (runId.includes(':task:')) {
          callbacks.onMessage?.({ type: 'thinking', text: 'subagent thinking', timestamp: Date.now() });
          callbacks.onMessage?.({ type: 'tool_use', toolName: 'Read', toolId: `nested-${runId}`, input: 'file.ts', timestamp: Date.now() });
          callbacks.onMessage?.({ type: 'assistant_text', text: 'Subagent answer', timestamp: Date.now() });
          callbacks.onMessage?.({ type: 'tool_result', toolId: `nested-${runId}`, result: 'contents', timestamp: Date.now() });
          callbacks.onMessage?.({ type: 'status', status: 'running', message: 'ignore me', timestamp: Date.now() });
          callbacks.onMessage?.({ type: 'agent_run_info', agentRunId: 'nested-run', timestamp: Date.now(), agentType: 'researcher' });
          return {
            exitCode: 0,
            output: 'Subagent answer',
            model: 'claude-opus-4-6',
          };
        }

        await callbacks.onClientToolCall?.({
          toolName: 'Task',
          toolUseId: 'task-tool-1',
          toolInput: {
            subagent_type: 'researcher',
            prompt: 'Inspect the codebase',
          },
          signal: new AbortController().signal,
        });

        return {
          exitCode: 0,
          output: 'Parent done',
          model: 'claude-opus-4-6',
        };
      });

      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue({
        ...createMockAgentLib(),
        execute,
      } satisfies IAgentLib);

      const events: Array<{ type: string; message?: AgentChatMessage }> = [];
      const result = await service.send('session-1', 'Run a subagent', {
        systemPrompt: '',
        onEvent: (event) => events.push(event as { type: string; message?: AgentChatMessage }),
      });

      await result.completion;

      const messages = events
        .filter((event): event is { type: 'message'; message: AgentChatMessage } => event.type === 'message' && !!event.message)
        .map((event) => event.message);

      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool_use', toolName: 'Task', toolId: 'task-tool-1' }),
        expect.objectContaining({ type: 'subagent_activity', agentName: 'researcher', status: 'started', toolUseId: 'task-tool-1' }),
        expect.objectContaining({ type: 'thinking', text: 'subagent thinking', parentToolUseId: 'task-tool-1' }),
        expect.objectContaining({ type: 'tool_use', toolName: 'Read', parentToolUseId: 'task-tool-1' }),
        expect.objectContaining({ type: 'assistant_text', text: 'Subagent answer', parentToolUseId: 'task-tool-1' }),
        expect.objectContaining({ type: 'tool_result', result: 'contents', parentToolUseId: 'task-tool-1' }),
        expect.objectContaining({ type: 'subagent_activity', agentName: 'researcher', status: 'completed', toolUseId: 'task-tool-1' }),
        expect.objectContaining({ type: 'tool_result', toolId: 'task-tool-1', result: 'Subagent answer' }),
      ]));
      expect(messages).not.toContainEqual(expect.objectContaining({ type: 'status', message: 'ignore me' }));
      expect(messages).not.toContainEqual(expect.objectContaining({ type: 'agent_run_info', agentRunId: 'nested-run' }));
    });

    it('keeps parallel same-type Task subagents correlated by parent tool id', async () => {
      const execute = vi.fn().mockImplementation(async (runId: string, _options, callbacks) => {
        if (runId.includes(':task:task-tool-1')) {
          callbacks.onMessage?.({ type: 'assistant_text', text: 'Result from task 1', timestamp: Date.now() });
          callbacks.onMessage?.({ type: 'thinking', text: 'thinking 1', timestamp: Date.now() });
          return {
            exitCode: 0,
            output: 'task 1 done',
            model: 'claude-opus-4-6',
          };
        }

        if (runId.includes(':task:task-tool-2')) {
          callbacks.onMessage?.({ type: 'assistant_text', text: 'Result from task 2', timestamp: Date.now() });
          callbacks.onMessage?.({ type: 'thinking', text: 'thinking 2', timestamp: Date.now() });
          return {
            exitCode: 0,
            output: 'task 2 done',
            model: 'claude-opus-4-6',
          };
        }

        await Promise.all([
          callbacks.onClientToolCall?.({
            toolName: 'Task',
            toolUseId: 'task-tool-1',
            toolInput: {
              subagent_type: 'researcher',
              prompt: 'Inspect area one',
            },
            signal: new AbortController().signal,
          }),
          callbacks.onClientToolCall?.({
            toolName: 'task',
            toolUseId: 'task-tool-2',
            toolInput: {
              subagent_type: 'researcher',
              prompt: 'Inspect area two',
            },
            signal: new AbortController().signal,
          }),
        ]);

        return {
          exitCode: 0,
          output: 'Parent done',
          model: 'claude-opus-4-6',
        };
      });

      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue({
        ...createMockAgentLib(),
        execute,
      } satisfies IAgentLib);

      const events: Array<{ type: string; message?: AgentChatMessage }> = [];
      const result = await service.send('session-1', 'Run two subagents', {
        systemPrompt: '',
        onEvent: (event) => events.push(event as { type: string; message?: AgentChatMessage }),
      });

      await result.completion;

      const messages = events
        .filter((event): event is { type: 'message'; message: AgentChatMessage } => event.type === 'message' && !!event.message)
        .map((event) => event.message);

      expect(messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'tool_use', toolName: 'Task', toolId: 'task-tool-1' }),
        expect.objectContaining({ type: 'tool_use', toolName: 'Task', toolId: 'task-tool-2' }),
        expect.objectContaining({ type: 'subagent_activity', agentName: 'researcher', status: 'started', toolUseId: 'task-tool-1' }),
        expect.objectContaining({ type: 'subagent_activity', agentName: 'researcher', status: 'started', toolUseId: 'task-tool-2' }),
        expect.objectContaining({ type: 'assistant_text', text: 'Result from task 1', parentToolUseId: 'task-tool-1' }),
        expect.objectContaining({ type: 'assistant_text', text: 'Result from task 2', parentToolUseId: 'task-tool-2' }),
        expect.objectContaining({ type: 'thinking', text: 'thinking 1', parentToolUseId: 'task-tool-1' }),
        expect.objectContaining({ type: 'thinking', text: 'thinking 2', parentToolUseId: 'task-tool-2' }),
        expect.objectContaining({ type: 'tool_result', toolId: 'task-tool-1', result: 'task 1 done' }),
        expect.objectContaining({ type: 'tool_result', toolId: 'task-tool-2', result: 'task 2 done' }),
      ]));

      expect(messages).not.toContainEqual(expect.objectContaining({
        type: 'assistant_text',
        text: 'Result from task 1',
        parentToolUseId: 'task-tool-2',
      }));
      expect(messages).not.toContainEqual(expect.objectContaining({
        type: 'assistant_text',
        text: 'Result from task 2',
        parentToolUseId: 'task-tool-1',
      }));
    });
  });

  describe('completion status', () => {
    it('does not emit a completed status message on successful agent completion', async () => {
      const execute = vi.fn().mockImplementation((_runId: string, _options: unknown, callbacks: { onOutput?: (s: string) => void; onMessage?: (m: AgentChatMessage) => void }) => {
        callbacks.onOutput?.('Test response\n');
        callbacks.onMessage?.({ type: 'assistant_text', text: 'Test response', timestamp: Date.now() });
        return Promise.resolve({
          exitCode: 0,
          output: 'Test response',
          costInputTokens: 10,
          costOutputTokens: 20,
          model: 'claude-opus-4-6',
        });
      });

      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue({
        ...createMockAgentLib(),
        execute,
      } satisfies IAgentLib);

      const events: Array<{ type: string; message?: AgentChatMessage }> = [];
      const result = await service.send('session-1', 'Test message', {
        systemPrompt: '',
        onEvent: (event) => events.push(event as { type: string; message?: AgentChatMessage }),
      });

      await result.completion;

      const messages = events
        .filter((event): event is { type: 'message'; message: AgentChatMessage } => event.type === 'message' && !!event.message)
        .map((event) => event.message);

      const statusMsg = messages.find((m) => m.type === 'status' && (m as { status?: string }).status === 'completed');
      expect(statusMsg).toBeUndefined();
    });

    it('emits a failed status with error message when agent returns an error', async () => {
      const execute = vi.fn().mockImplementation((_runId: string, _options: unknown, callbacks: { onOutput?: (s: string) => void; onMessage?: (m: AgentChatMessage) => void }) => {
        callbacks.onOutput?.('Test response\n');
        callbacks.onMessage?.({ type: 'assistant_text', text: 'Test response', timestamp: Date.now() });
        return Promise.resolve({
          exitCode: 1,
          output: 'Test response',
          error: 'Agent reached the maximum turn limit (50 turns). You can continue the conversation to pick up where it left off.',
          model: 'claude-opus-4-6',
        });
      });

      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue({
        ...createMockAgentLib(),
        execute,
      } satisfies IAgentLib);

      const events: Array<{ type: string; message?: AgentChatMessage }> = [];
      const result = await service.send('session-1', 'Test message', {
        systemPrompt: '',
        onEvent: (event) => events.push(event as { type: string; message?: AgentChatMessage }),
      });

      await result.completion;

      const messages = events
        .filter((event): event is { type: 'message'; message: AgentChatMessage } => event.type === 'message' && !!event.message)
        .map((event) => event.message);

      const statusMsg = messages.find((m) => m.type === 'status' && (m as { status?: string }).status === 'failed');
      expect(statusMsg).toBeDefined();
      expect((statusMsg as { message?: string }).message).toContain('maximum turn limit');
    });
  });
});
