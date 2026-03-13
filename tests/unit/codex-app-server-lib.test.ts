import { describe, expect, it, vi } from 'vitest';
import type { AgentChatMessage } from '../../src/shared/types';
import { CodexAppServerLib } from '../../src/core/libs/codex-app-server-lib';
import type {
  CodexAppServerClientOptions,
  CodexAppServerThreadResumeParams,
  CodexAppServerThreadResumeResponse,
  CodexAppServerThreadStartParams,
  CodexAppServerThreadStartResponse,
  CodexAppServerTurnInterruptParams,
  CodexAppServerTurnStartParams,
  CodexAppServerTurnStartResponse,
} from '../../src/core/libs/codex-app-server-client';

class FakeCodexAppServerClient {
  static instances: FakeCodexAppServerClient[] = [];

  readonly start = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  readonly turnInterrupt = vi.fn(async (_params: CodexAppServerTurnInterruptParams) => undefined);
  readonly threadStart = vi.fn(async (_params: CodexAppServerThreadStartParams): Promise<CodexAppServerThreadStartResponse> => ({
    thread: { id: 'thread-1', cwd: '/tmp/project' },
  }));
  readonly threadResume = vi.fn(async (params: CodexAppServerThreadResumeParams): Promise<CodexAppServerThreadResumeResponse> => ({
    thread: { id: params.threadId, cwd: '/tmp/project' },
  }));
  readonly turnStart = vi.fn(async (_params: CodexAppServerTurnStartParams): Promise<CodexAppServerTurnStartResponse> => {
    this.options.onNotification?.({
      method: 'turn/started',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', error: null } },
    });
    this.options.onNotification?.({
      method: 'item/reasoning/textDelta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'reason-1', delta: 'thinking...' },
    });
    this.options.onNotification?.({
      method: 'item/agentMessage/delta',
      params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'msg-1', delta: 'hello world' },
    });
    this.options.onNotification?.({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        tokenUsage: {
          total: {
            inputTokens: 10,
            cachedInputTokens: 2,
            outputTokens: 5,
          },
          modelContextWindow: 128000,
        },
      },
    });
    this.options.onNotification?.({
      method: 'turn/completed',
      params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
    });
    return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
  });

  constructor(private readonly options: CodexAppServerClientOptions) {
    FakeCodexAppServerClient.instances.push(this);
  }
}

describe('CodexAppServerLib', () => {
  it('normalizes app-server deltas into assistant/thinking/usage messages', async () => {
    const lib = new CodexAppServerLib(undefined, (options) => new FakeCodexAppServerClient(options) as never);
    const chunks: string[] = [];
    const messages: AgentChatMessage[] = [];

    const result = await lib.execute('run-1', {
      prompt: 'say hello',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: [],
      readOnlyPaths: [],
      readOnly: true,
      sessionId: 'session-1',
    }, {
      onOutput: (chunk) => chunks.push(chunk),
      onMessage: (message) => messages.push(message),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('hello world');
    expect(result.costInputTokens).toBe(12);
    expect(result.costOutputTokens).toBe(5);
    expect(result.cacheReadInputTokens).toBe(2);
    expect(result.contextWindow).toBe(128000);
    expect(chunks.join('')).toBe('hello world');
    expect(messages.some((message) => message.type === 'thinking')).toBe(true);
    expect(messages.some((message) => message.type === 'assistant_text')).toBe(true);
    expect(messages.some((message) => message.type === 'usage')).toBe(true);
  });

  it('reuses the mapped thread id on resume', async () => {
    FakeCodexAppServerClient.instances.length = 0;
    const lib = new CodexAppServerLib(undefined, (options) => new FakeCodexAppServerClient(options) as never);

    await lib.execute('run-1', {
      prompt: 'first',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: [],
      readOnlyPaths: [],
      readOnly: true,
      sessionId: 'session-1',
    }, {});

    await lib.execute('run-2', {
      prompt: 'second',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: [],
      readOnlyPaths: [],
      readOnly: true,
      sessionId: 'session-1',
      resumeSession: true,
    }, {});

    expect(FakeCodexAppServerClient.instances).toHaveLength(2);
    expect(FakeCodexAppServerClient.instances[1].threadResume).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1',
    }));
  });

  it('surfaces non-retryable server error notifications', async () => {
    class ErroringClient extends FakeCodexAppServerClient {
      override readonly turnStart = vi.fn(async (): Promise<CodexAppServerTurnStartResponse> => {
        this['options'].onNotification?.({
          method: 'turn/started',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', error: null } },
        });
        this['options'].onNotification?.({
          method: 'error',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            willRetry: false,
            error: {
              message: 'turn failed',
              additionalDetails: 'details',
            },
          },
        });
        return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
      });
    }

    const lib = new CodexAppServerLib(undefined, (options) => new ErroringClient(options) as never);
    const result = await lib.execute('run-error', {
      prompt: 'fail',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: [],
      readOnlyPaths: [],
      readOnly: true,
    }, {});

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('turn failed');
    expect(result.error).toContain('details');
  });
});
