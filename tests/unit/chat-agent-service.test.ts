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
import type { AgentChatMessage, AgentRun, Project } from '../../src/shared/types';
import type { IAgentRunStore } from '../../src/core/interfaces/agent-run-store';

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
    supportedFeatures: () => ({ images: true, hooks: true, thinking: true, nativeResume: true, streamingInput: true }),
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
    injectMessage: vi.fn().mockReturnValue(false),
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
    enableStreamingInput: false,
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
      updateSessionStatus: vi.fn().mockResolvedValue(undefined),
      resetStaleStatuses: vi.fn().mockResolvedValue(undefined),
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
        enableStreamingInput: false,
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
        supportedFeatures: () => ({ images: true, hooks: false, thinking: true, nativeResume: true, streamingInput: false }),
        getDefaultModel: () => 'gpt-5.4',
        getSupportedModels: () => [{ value: 'gpt-5.4', label: 'GPT-5.4' }],
        execute,
        stop: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getTelemetry: vi.fn().mockReturnValue(null),
        injectMessage: vi.fn().mockReturnValue(false),
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
      // stop() emits 'idle' — session is ready for new messages
      expect(agents[0].status).toBe('idle');
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

      expect(mockMessageStore.addMessage).toHaveBeenCalled();
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

  describe('mid-execution message injection', () => {
    const injectionSession: ChatSession = {
      ...mockSession,
      enableStreamingInput: true,
    };

    /**
     * Creates a mock lib whose execute() holds open until resolve() is called,
     * simulating a long-running agent that can receive injected messages.
     */
    function createHoldingMockLib() {
      let resolveExecute: ((result: { exitCode: number; output: string; model: string }) => void) | null = null;
      const lib: IAgentLib = {
        name: 'claude-code',
        supportedFeatures: () => ({ images: true, hooks: true, thinking: true, nativeResume: true, streamingInput: true }),
        getDefaultModel: () => 'claude-opus-4-6',
        getSupportedModels: () => [{ value: 'claude-opus-4-6', label: 'Claude Opus 4.6' }],
        execute: vi.fn().mockImplementation((_runId: string, _options: unknown, callbacks: { onOutput?: (s: string) => void; onMessage?: (m: AgentChatMessage) => void }) => {
          callbacks.onOutput?.('Initial response\n');
          callbacks.onMessage?.({ type: 'assistant_text', text: 'Initial response', timestamp: Date.now() });
          return new Promise((resolve) => {
            resolveExecute = resolve;
          });
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getTelemetry: vi.fn().mockReturnValue(null),
        injectMessage: vi.fn().mockReturnValue(true),
      };
      return {
        lib,
        resolve: () => resolveExecute?.({ exitCode: 0, output: 'Done', model: 'claude-opus-4-6' }),
      };
    }

    it('does NOT emit user message via WebSocket during injection (Bug 1 fix)', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(injectionSession);
      const { lib } = createHoldingMockLib();
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      const events: Array<{ type: string; message?: AgentChatMessage }> = [];
      // Start the agent
      await service.send('session-1', 'First message', {
        systemPrompt: '',
        onEvent: (event) => events.push(event as { type: string; message?: AgentChatMessage }),
      });

      // Clear events from the initial send
      events.length = 0;

      // Inject a message
      const injectResult = await service.send('session-1', 'Injected message', {
        systemPrompt: '',
        onEvent: (event) => events.push(event as { type: string; message?: AgentChatMessage }),
      });

      expect(injectResult.injected).toBe(true);
      // There should be NO 'message' event with type: 'user' emitted via WS
      const userMessages = events.filter(
        (e) => e.type === 'message' && e.message?.type === 'user',
      );
      expect(userMessages).toHaveLength(0);
    });

    it('persists pre-injection assistant messages to DB before the injected user message (Bug 4 fix)', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(injectionSession);
      const { lib } = createHoldingMockLib();
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      const addMessageCalls: Array<{ role: string; content: string }> = [];
      (mockMessageStore.addMessage as ReturnType<typeof vi.fn>).mockImplementation(async (input: { role: string; content: string }) => {
        addMessageCalls.push({ role: input.role, content: input.content });
        return { id: `msg-${addMessageCalls.length}`, sessionId: 'session-1', role: input.role, content: input.content, createdAt: Date.now() };
      });

      // Start the agent — this persists the initial user message
      await service.send('session-1', 'First message', { systemPrompt: '' });

      // Clear the tracked calls from the initial send
      addMessageCalls.length = 0;

      // Inject a message — should persist assistant messages first, then user message
      await service.send('session-1', 'Injected message', { systemPrompt: '' });

      // Expect: first an assistant message (pre-injection snapshot), then the injected user message
      expect(addMessageCalls.length).toBeGreaterThanOrEqual(2);
      expect(addMessageCalls[0].role).toBe('assistant');
      // The assistant content should be a JSON array containing the initial response
      const assistantContent = JSON.parse(addMessageCalls[0].content);
      expect(Array.isArray(assistantContent)).toBe(true);
      expect(assistantContent).toContainEqual(
        expect.objectContaining({ type: 'assistant_text', text: 'Initial response' }),
      );
      // The second call should be the injected user message
      expect(addMessageCalls[1].role).toBe('user');
      expect(addMessageCalls[1].content).toBe('Injected message');
    });

    it('returns the injected user message via REST response', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(injectionSession);
      const { lib } = createHoldingMockLib();
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      // Start the agent
      await service.send('session-1', 'First message', { systemPrompt: '' });

      // Inject a message
      const result = await service.send('session-1', 'Injected message', { systemPrompt: '' });

      expect(result.injected).toBe(true);
      expect(result.userMessage).toBeDefined();
      expect(result.sessionId).toBe('session-1');
    });

    it('clears turnMessages after intermediate persistence so finally block only persists post-injection messages', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(injectionSession);
      const { lib, resolve } = createHoldingMockLib();
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      const addMessageCalls: Array<{ role: string; content: string }> = [];
      (mockMessageStore.addMessage as ReturnType<typeof vi.fn>).mockImplementation(async (input: { role: string; content: string }) => {
        addMessageCalls.push({ role: input.role, content: input.content });
        return { id: `msg-${addMessageCalls.length}`, sessionId: 'session-1', role: input.role, content: input.content, createdAt: Date.now() };
      });

      // Start the agent
      const sendResult = await service.send('session-1', 'First message', { systemPrompt: '' });

      // Inject a message
      await service.send('session-1', 'Injected message', { systemPrompt: '' });

      // Resolve the agent (completes runAgent)
      resolve();
      await sendResult.completion;

      // Check that the finally block persisted an assistant message
      // (which should be empty since pre-injection messages were already saved)
      const assistantMessages = addMessageCalls.filter((c) => c.role === 'assistant');
      // First assistant message: pre-injection snapshot (contains 'Initial response')
      expect(assistantMessages[0]).toBeDefined();
      const firstContent = JSON.parse(assistantMessages[0].content);
      expect(firstContent).toContainEqual(expect.objectContaining({ type: 'assistant_text', text: 'Initial response' }));

      // If there's a second assistant message from finally block, it should NOT contain 'Initial response' again
      if (assistantMessages.length > 1) {
        const secondContent = JSON.parse(assistantMessages[1].content);
        expect(secondContent).not.toContainEqual(expect.objectContaining({ type: 'assistant_text', text: 'Initial response' }));
      }
    });

    it('retries as new message when injection channel closes before agent cleanup (race condition fix)', async () => {
      // This test needs real timers because the fix polls with setTimeout
      vi.useRealTimers();

      mockSessionStore.getSession = vi.fn().mockResolvedValue(injectionSession);

      // Create a mock lib that simulates the race condition:
      // - execute() holds open initially (agent appears running)
      // - injectMessage() returns false (channel closed — SDK finished but finally not yet run)
      // - After a brief delay the execute() resolves (simulating finally block cleanup)
      let resolveExecute: ((result: { exitCode: number; output: string; model: string }) => void) | null = null;
      let secondExecuteCall = false;
      const lib: IAgentLib = {
        name: 'claude-code',
        supportedFeatures: () => ({ images: true, hooks: true, thinking: true, nativeResume: true, streamingInput: true }),
        getDefaultModel: () => 'claude-opus-4-6',
        getSupportedModels: () => [{ value: 'claude-opus-4-6', label: 'Claude Opus 4.6' }],
        execute: vi.fn().mockImplementation((_runId: string, _options: unknown, callbacks: { onOutput?: (s: string) => void; onMessage?: (m: AgentChatMessage) => void }) => {
          if (secondExecuteCall) {
            // Second call (retry): resolve immediately
            callbacks.onOutput?.('Retry response\n');
            callbacks.onMessage?.({ type: 'assistant_text', text: 'Retry response', timestamp: Date.now() });
            return Promise.resolve({ exitCode: 0, output: 'Retry response', model: 'claude-opus-4-6' });
          }
          callbacks.onOutput?.('Initial response\n');
          callbacks.onMessage?.({ type: 'assistant_text', text: 'Initial response', timestamp: Date.now() });
          return new Promise((resolve) => { resolveExecute = resolve; });
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getTelemetry: vi.fn().mockReturnValue(null),
        // Always return false to simulate channel-closed race condition
        injectMessage: vi.fn().mockReturnValue(false),
      };
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      // Start the agent (first execute call — holds open)
      const firstResult = await service.send('session-1', 'First message', { systemPrompt: '' });

      // Resolve the first execute after a brief delay to simulate the
      // finally block completing during the send() polling wait.
      setTimeout(() => {
        secondExecuteCall = true;
        resolveExecute?.({ exitCode: 0, output: 'Done', model: 'claude-opus-4-6' });
      }, 200);

      // This should NOT throw — it should wait for cleanup and retry as a fresh send
      const retryResult = await service.send('session-1', 'Follow-up message', { systemPrompt: '' });

      // The result should be a normal (non-injected) send result
      expect(retryResult.injected).toBeUndefined();
      expect(retryResult.userMessage).toBeDefined();
      expect(retryResult.sessionId).toBe('session-1');

      // Wait for completions
      await firstResult.completion;
      await retryResult.completion;

      // Restore fake timers for the rest of the suite
      vi.useFakeTimers();
    });

    it('succeeds when injection is attempted immediately after agent start (runningRunIds race condition fix)', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(injectionSession);
      const { lib, resolve } = createHoldingMockLib();
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      // Start the agent — runningControllers and runningRunIds should both be set
      // synchronously before runAgent() starts executing asynchronously.
      const firstResult = await service.send('session-1', 'First message', { systemPrompt: '' });

      // Immediately inject a message (no awaits between start and inject).
      // Before the fix, this would throw "no runId mapped for session" because
      // runningRunIds was only set inside the async runAgent() body.
      const injectResult = await service.send('session-1', 'Injected immediately', { systemPrompt: '' });

      expect(injectResult.injected).toBe(true);
      expect(injectResult.userMessage).toBeDefined();
      expect(injectResult.sessionId).toBe('session-1');
      expect(lib.injectMessage).toHaveBeenCalled();

      // Clean up: resolve the holding execute so runAgent() completes
      resolve();
      await firstResult.completion;
    });

    it('restores turnMessages on intermediate persistence failure so finally block still persists them', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(injectionSession);
      const { lib, resolve } = createHoldingMockLib();
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      let callCount = 0;
      const addMessageCalls: Array<{ role: string; content: string }> = [];
      (mockMessageStore.addMessage as ReturnType<typeof vi.fn>).mockImplementation(async (input: { role: string; content: string }) => {
        callCount++;
        // Fail on the 2nd call — the intermediate assistant persistence.
        // Call 1 is the initial user message from send().
        if (callCount === 2) {
          throw new Error('Simulated DB failure');
        }
        addMessageCalls.push({ role: input.role, content: input.content });
        return { id: `msg-${addMessageCalls.length}`, sessionId: 'session-1', role: input.role, content: input.content, createdAt: Date.now() };
      });

      // Start the agent — call 1: persists the initial user message
      const sendResult = await service.send('session-1', 'First message', { systemPrompt: '' });

      // Inject a message — call 2: intermediate assistant persist FAILS, call 3: injected user message
      await service.send('session-1', 'Injected message', { systemPrompt: '' });

      // Resolve the agent (completes runAgent → finally block runs)
      resolve();
      await sendResult.completion;

      // The finally block should have persisted assistant messages that include
      // the restored pre-injection messages (since intermediate persistence failed)
      const assistantMessages = addMessageCalls.filter((c) => c.role === 'assistant');
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
      // The finally-block assistant message should contain the 'Initial response'
      // because the error recovery restored it to turnMessages
      const lastAssistant = assistantMessages[assistantMessages.length - 1];
      const content = JSON.parse(lastAssistant.content);
      expect(content).toContainEqual(
        expect.objectContaining({ type: 'assistant_text', text: 'Initial response' }),
      );
    });
  });

  describe('streaming-input onTurnComplete', () => {
    const streamingSession: ChatSession = {
      ...mockSession,
      enableStreamingInput: true,
    };

    /**
     * Creates a mock lib that simulates streaming-input behavior:
     * - execute() calls onTurnComplete mid-execution (like claude-code-lib does on SDK result)
     * - execute() stays alive until resolve() is called (simulating the open message channel)
     */
    function createStreamingInputMockLib() {
      let resolveExecute: ((result: { exitCode: number; output: string; model: string }) => void) | null = null;
      const lib: IAgentLib = {
        name: 'claude-code',
        supportedFeatures: () => ({ images: true, hooks: true, thinking: true, nativeResume: true, streamingInput: true }),
        getDefaultModel: () => 'claude-opus-4-6',
        getSupportedModels: () => [{ value: 'claude-opus-4-6', label: 'Claude Opus 4.6' }],
        execute: vi.fn().mockImplementation((_runId: string, _options: unknown, callbacks: {
          onOutput?: (s: string) => void;
          onMessage?: (m: AgentChatMessage) => void;
          onTurnComplete?: () => void;
        }) => {
          // Emit assistant response then call onTurnComplete (simulating SDK result during streaming input)
          callbacks.onOutput?.('Turn 1 response\n');
          callbacks.onMessage?.({ type: 'assistant_text', text: 'Turn 1 response', timestamp: Date.now() });
          callbacks.onTurnComplete?.();
          return new Promise((resolve) => {
            resolveExecute = resolve;
          });
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getTelemetry: vi.fn().mockReturnValue(null),
        injectMessage: vi.fn().mockReturnValue(true),
      };
      return {
        lib,
        resolve: () => resolveExecute?.({ exitCode: 0, output: 'Done', model: 'claude-opus-4-6' }),
      };
    }

    it('emits status change on turn completion via statusChangeCallback', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(streamingSession);
      const { lib } = createStreamingInputMockLib();
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      const statusChanges: Array<{ sessionId: string; status: string }> = [];
      service.setStatusChangeCallback((sessionId, status) => {
        statusChanges.push({ sessionId, status });
      });

      await service.send('session-1', 'Hello', {
        systemPrompt: '',
      });

      // Flush microtasks so the background runAgentDelegate reaches execute()
      await vi.advanceTimersByTimeAsync(0);

      // onTurnComplete should have fired and emitted a status change.
      // With no pending questions, the status is 'idle' (not 'waiting_for_input').
      const turnCompleteEvents = statusChanges.filter(e => e.status === 'idle' || e.status === 'waiting_for_input');
      expect(turnCompleteEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('persists turn messages on turn completion', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(streamingSession);
      const { lib } = createStreamingInputMockLib();
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      const addMessageCalls: Array<{ role: string; content: string }> = [];
      (mockMessageStore.addMessage as ReturnType<typeof vi.fn>).mockImplementation(async (input: { role: string; content: string }) => {
        addMessageCalls.push({ role: input.role, content: input.content });
        return { id: `msg-${addMessageCalls.length}`, sessionId: 'session-1', role: input.role, content: input.content, createdAt: Date.now() };
      });

      await service.send('session-1', 'Hello', { systemPrompt: '' });
      await vi.advanceTimersByTimeAsync(0);

      // onTurnComplete should have persisted the assistant messages
      const assistantPersists = addMessageCalls.filter(c => c.role === 'assistant');
      expect(assistantPersists.length).toBeGreaterThanOrEqual(1);
      const content = JSON.parse(assistantPersists[0].content);
      expect(content).toContainEqual(
        expect.objectContaining({ type: 'assistant_text', text: 'Turn 1 response' }),
      );
    });

    it('updates session status to idle (not waiting_for_input) on turn completion when no questions pending', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(streamingSession);
      const { lib } = createStreamingInputMockLib();
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      await service.send('session-1', 'Hello', { systemPrompt: '' });
      await vi.advanceTimersByTimeAsync(0);

      // DB status should transition: running → idle (not waiting_for_input,
      // since no pending questions exist)
      const statusCalls = (mockSessionStore.updateSessionStatus as ReturnType<typeof vi.fn>).mock.calls;
      const statuses = statusCalls.map((c: unknown[]) => c[1]);
      expect(statuses).toContain('running');
      expect(statuses).toContain('idle');
      // waiting_for_input should NOT be set when there are no pending questions
      expect(statuses).not.toContain('waiting_for_input');
    });

    it('restores running status when message is injected into idle session', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(streamingSession);
      const { lib } = createStreamingInputMockLib();
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      // Start the agent — onTurnComplete sets both in-memory and DB status to idle
      await service.send('session-1', 'Hello', { systemPrompt: '' });
      await vi.advanceTimersByTimeAsync(0);

      // Check that the in-memory agent is idle (turn completed, no pending questions)
      const runningAgents = await service.getRunningAgents();
      const agent = runningAgents.find((a: RunningAgent) => a.sessionId === 'session-1');
      expect(agent?.status).toBe('idle');

      // Inject a message — should restore running status
      await service.send('session-1', 'Follow-up', { systemPrompt: '' });

      const statusCalls = (mockSessionStore.updateSessionStatus as ReturnType<typeof vi.fn>).mock.calls;
      const statuses = statusCalls.map((c: unknown[]) => c[1]);
      // DB status should see: running → idle → running
      expect(statuses).toEqual(expect.arrayContaining(['running', 'idle', 'running']));
    });

    it('restores turnMessages on persistence failure so finally block can retry', async () => {
      mockSessionStore.getSession = vi.fn().mockResolvedValue(streamingSession);

      // Create a lib where onTurnComplete fires, then execute resolves shortly after
      let resolveExecute: ((result: { exitCode: number; output: string; model: string }) => void) | null = null;
      const lib: IAgentLib = {
        name: 'claude-code',
        supportedFeatures: () => ({ images: true, hooks: true, thinking: true, nativeResume: true, streamingInput: true }),
        getDefaultModel: () => 'claude-opus-4-6',
        getSupportedModels: () => [{ value: 'claude-opus-4-6', label: 'Claude Opus 4.6' }],
        execute: vi.fn().mockImplementation((_runId: string, _options: unknown, callbacks: {
          onOutput?: (s: string) => void;
          onMessage?: (m: AgentChatMessage) => void;
          onTurnComplete?: () => void;
        }) => {
          callbacks.onOutput?.('Response\n');
          callbacks.onMessage?.({ type: 'assistant_text', text: 'Response', timestamp: Date.now() });
          callbacks.onTurnComplete?.();
          return new Promise((resolve) => { resolveExecute = resolve; });
        }),
        stop: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockResolvedValue(true),
        getTelemetry: vi.fn().mockReturnValue(null),
        injectMessage: vi.fn().mockReturnValue(false),
      };
      mockAgentLibRegistry.getLib = vi.fn().mockReturnValue(lib);

      // Make the first addMessage call (user message) succeed,
      // the second (onTurnComplete assistant persist) fail,
      // and subsequent calls succeed (finally block retry)
      let callCount = 0;
      const addMessageCalls: Array<{ role: string; content: string }> = [];
      (mockMessageStore.addMessage as ReturnType<typeof vi.fn>).mockImplementation(async (input: { role: string; content: string }) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Simulated DB failure');
        }
        addMessageCalls.push({ role: input.role, content: input.content });
        return { id: `msg-${addMessageCalls.length}`, sessionId: 'session-1', role: input.role, content: input.content, createdAt: Date.now() };
      });

      const sendResult = await service.send('session-1', 'Hello', { systemPrompt: '' });

      // Let the rejected promise settle so the .catch() handler restores turnMessages
      await vi.advanceTimersByTimeAsync(0);

      // Resolve execute — the finally block should retry with the restored messages
      resolveExecute?.({ exitCode: 0, output: 'Done', model: 'claude-opus-4-6' });
      await sendResult.completion;

      // The finally block should have persisted the restored messages
      const assistantPersists = addMessageCalls.filter(c => c.role === 'assistant');
      expect(assistantPersists.length).toBeGreaterThanOrEqual(1);
      const content = JSON.parse(assistantPersists[assistantPersists.length - 1].content);
      expect(content).toContainEqual(
        expect.objectContaining({ type: 'assistant_text', text: 'Response' }),
      );
    });
  });

  describe('AgentRun prompt serialization', () => {
    it('stores the system prompt text (not [object Object]) when systemPrompt is a preset object', async () => {
      const agentChatSession: ChatSession = {
        id: 'session-1',
        projectId: 'project-1',
        scopeType: 'task',
        scopeId: 'task-1',
        name: 'Agent Chat Session',
        agentLib: null,
        source: 'agent-chat',
        agentRole: 'investigator',
        agentRunId: null,
        permissionMode: null,
        sidebarHidden: false,
        systemPromptAppend: null,
        model: null,
        enableStreaming: true,
        enableStreamingInput: false,
        draft: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const mockAgentRun: AgentRun = {
        id: 'run-1',
        taskId: 'task-1',
        agentType: 'investigator',
        mode: 'revision',
        status: 'running',
        output: null,
        outcome: null,
        payload: {},
        exitCode: null,
        startedAt: Date.now(),
        completedAt: null,
        costInputTokens: 0,
        costOutputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        totalCostUsd: 0,
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
      };

      let capturedPrompt: string | null = null;
      const mockAgentRunStore: IAgentRunStore = {
        createRun: vi.fn().mockResolvedValue(mockAgentRun),
        updateRun: vi.fn().mockImplementation((_id: string, input: { prompt?: string }) => {
          capturedPrompt = input.prompt ?? null;
          return Promise.resolve({ ...mockAgentRun, ...input });
        }),
        getRun: vi.fn().mockResolvedValue(mockAgentRun),
        getRunsForTask: vi.fn().mockResolvedValue([]),
        getActiveRuns: vi.fn().mockResolvedValue([]),
        getAllRuns: vi.fn().mockResolvedValue([]),
        getRunsForAutomatedAgent: vi.fn().mockResolvedValue([]),
        getActiveRunForAutomatedAgent: vi.fn().mockResolvedValue(null),
        countFailedRunsSync: vi.fn().mockReturnValue(0),
        countRunningRunsSync: vi.fn().mockReturnValue(0),
      };

      mockSessionStore.getSession = vi.fn().mockResolvedValue(agentChatSession);
      mockSessionStore.updateSession = vi.fn().mockResolvedValue(agentChatSession);

      mockTaskStore.getTask = vi.fn().mockResolvedValue({
        id: 'task-1',
        projectId: 'project-1',
        pipelineId: 'pipeline-1',
        title: 'Test Task',
        description: null,
        type: 'task',
        size: null,
        complexity: null,
        status: 'investigation_review',
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
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: null,
      });

      const serviceWithRunStore = new ChatAgentService(
        mockMessageStore, mockSessionStore, mockProjectStore,
        mockTaskStore, mockPipelineStore, mockAgentLibRegistry,
        mockAgentRunStore,
      );

      const presetSystemPrompt = { type: 'preset' as const, preset: 'claude_code' as const, append: 'You are an investigator agent.\n\nWorktree safety rules...' };

      const result = await serviceWithRunStore.send('session-1', 'Test message', {
        systemPrompt: presetSystemPrompt,
      });

      // Let the agent run complete
      await vi.advanceTimersByTimeAsync(200);
      await result.completion;

      // Verify updateRun was called and the prompt does NOT contain [object Object]
      expect(mockAgentRunStore.updateRun).toHaveBeenCalled();
      expect(capturedPrompt).toBeDefined();
      expect(capturedPrompt).not.toContain('[object Object]');
      // Verify the prompt contains the actual append text
      expect(capturedPrompt).toContain('You are an investigator agent.');
    });
  });
});
