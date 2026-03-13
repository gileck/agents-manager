import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

function makeSessionMapPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-app-server-lib-test-')), 'thread-map.json');
}

class FakeCodexAppServerClient {
  static instances: FakeCodexAppServerClient[] = [];
  approvalDecisions: unknown[] = [];
  dynamicToolResponses: unknown[] = [];

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

  constructor(protected readonly options: CodexAppServerClientOptions) {
    FakeCodexAppServerClient.instances.push(this);
  }
}

describe('CodexAppServerLib', () => {
  it('normalizes app-server deltas into assistant/thinking/usage messages', async () => {
    const lib = new CodexAppServerLib(undefined, (options) => new FakeCodexAppServerClient(options) as never, {
      sessionMapPath: makeSessionMapPath(),
    });
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
    expect(result.costInputTokens).toBe(10);
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
    const sessionMapPath = makeSessionMapPath();
    const lib = new CodexAppServerLib(undefined, (options) => new FakeCodexAppServerClient(options) as never, {
      sessionMapPath,
    });

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

  it('persists thread mapping across lib instances and reports nativeResume', async () => {
    FakeCodexAppServerClient.instances.length = 0;
    const sessionMapPath = makeSessionMapPath();

    const firstLib = new CodexAppServerLib(undefined, (options) => new FakeCodexAppServerClient(options) as never, {
      sessionMapPath,
    });
    expect(firstLib.supportedFeatures().nativeResume).toBe(true);

    await firstLib.execute('run-1', {
      prompt: 'first',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: [],
      readOnlyPaths: [],
      readOnly: true,
      sessionId: 'session-persisted',
    }, {});

    const secondLib = new CodexAppServerLib(undefined, (options) => new FakeCodexAppServerClient(options) as never, {
      sessionMapPath,
    });

    await secondLib.execute('run-2', {
      prompt: 'second',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: [],
      readOnlyPaths: [],
      readOnly: true,
      sessionId: 'session-persisted',
      resumeSession: true,
    }, {});

    expect(FakeCodexAppServerClient.instances).toHaveLength(2);
    expect(FakeCodexAppServerClient.instances[1].threadResume).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1',
    }));
  });

  it('parses structured output from the final assistant text', async () => {
    class StructuredOutputClient extends FakeCodexAppServerClient {
      override readonly turnStart = vi.fn(async (): Promise<CodexAppServerTurnStartResponse> => {
        this['options'].onNotification?.({
          method: 'turn/started',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', error: null } },
        });
        this['options'].onNotification?.({
          method: 'item/completed',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            item: { type: 'agentMessage', id: 'msg-1', text: '{"greeting":"hello","count":2}' },
          },
        });
        this['options'].onNotification?.({
          method: 'turn/completed',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
        });
        return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
      });
    }

    const lib = new CodexAppServerLib(undefined, (options) => new StructuredOutputClient(options) as never, {
      sessionMapPath: makeSessionMapPath(),
    });

    const result = await lib.execute('run-json', {
      prompt: 'return json',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: [],
      readOnlyPaths: [],
      readOnly: true,
      outputFormat: {
        type: 'object',
        properties: {
          greeting: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['greeting', 'count'],
      },
    }, {});

    expect(result.exitCode).toBe(0);
    expect(result.structuredOutput).toEqual({ greeting: 'hello', count: 2 });
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

    const lib = new CodexAppServerLib(undefined, (options) => new ErroringClient(options) as never, {
      sessionMapPath: makeSessionMapPath(),
    });
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

  it('routes command approval requests through onPermissionRequest', async () => {
    class ApprovalClient extends FakeCodexAppServerClient {
      override readonly turnStart = vi.fn(async (): Promise<CodexAppServerTurnStartResponse> => {
        this.options.onNotification?.({
          method: 'turn/started',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', error: null } },
        });
        const decision = await this.options.onServerRequest?.({
          method: 'item/commandExecution/requestApproval',
          id: 'request-1',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'cmd-1',
            command: 'ls /tmp/project',
            cwd: '/tmp/project',
            reason: 'Needs listing access',
          },
        });
        this.approvalDecisions.push(decision);
        this.options.onNotification?.({
          method: 'turn/completed',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
        });
        return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
      });
    }

    FakeCodexAppServerClient.instances.length = 0;
    const onPermissionRequest = vi.fn().mockResolvedValue({ allowed: false });
    const lib = new CodexAppServerLib(undefined, (options) => new ApprovalClient(options) as never, {
      sessionMapPath: makeSessionMapPath(),
    });

    const result = await lib.execute('run-approval', {
      prompt: 'cleanup',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: ['/tmp/project'],
      readOnlyPaths: [],
      readOnly: false,
    }, {
      onPermissionRequest,
    });

    expect(result.exitCode).toBe(0);
    expect(onPermissionRequest).toHaveBeenCalledWith({
      toolName: 'Bash',
      toolInput: expect.objectContaining({
        command: 'ls /tmp/project',
        cwd: '/tmp/project',
        reason: 'Needs listing access',
      }),
      toolUseId: 'cmd-1',
    });
    expect(FakeCodexAppServerClient.instances[0].approvalDecisions).toEqual(['decline']);
  });

  it('returns a structured failure result for unsupported dynamic tools', async () => {
    class DynamicToolClient extends FakeCodexAppServerClient {
      override readonly turnStart = vi.fn(async (): Promise<CodexAppServerTurnStartResponse> => {
        this.options.onNotification?.({
          method: 'turn/started',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', error: null } },
        });
        const response = await this.options.onServerRequest?.({
          method: 'item/tool/call',
          id: 'request-2',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            callId: 'tool-1',
            tool: 'AskUserQuestion',
            arguments: { question: 'continue?' },
          },
        });
        this.dynamicToolResponses.push(response);
        this.options.onNotification?.({
          method: 'turn/completed',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
        });
        return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
      });
    }

    FakeCodexAppServerClient.instances.length = 0;
    const messages: AgentChatMessage[] = [];
    const userToolResults: Array<{ toolUseId: string; content: string }> = [];
    const lib = new CodexAppServerLib(undefined, (options) => new DynamicToolClient(options) as never, {
      sessionMapPath: makeSessionMapPath(),
    });

    await lib.execute('run-dynamic-tool', {
      prompt: 'call dynamic tool',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: ['/tmp/project'],
      readOnlyPaths: [],
      readOnly: false,
    }, {
      onMessage: (message) => messages.push(message),
      onUserToolResult: (toolUseId, content) => userToolResults.push({ toolUseId, content }),
    });

    expect(FakeCodexAppServerClient.instances[0].dynamicToolResponses).toEqual([
      {
        success: false,
        contentItems: [{ type: 'inputText', text: 'Client-handled tool AskUserQuestion is not implemented yet in CodexAppServerLib.' }],
      },
    ]);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_use', toolName: 'AskUserQuestion', toolId: 'tool-1' }),
      expect.objectContaining({ type: 'tool_result', toolId: 'tool-1' }),
    ]));
    expect(userToolResults).toEqual([
      {
        toolUseId: 'tool-1',
        content: 'Client-handled tool AskUserQuestion is not implemented yet in CodexAppServerLib.',
      },
    ]);
  });

  it('dispatches dynamic tool calls through onClientToolCall when configured', async () => {
    class DynamicToolClient extends FakeCodexAppServerClient {
      dynamicToolResponses: unknown[] = [];

      override readonly turnStart = vi.fn(async (): Promise<CodexAppServerTurnStartResponse> => {
        this.options.onNotification?.({
          method: 'turn/started',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', error: null } },
        });
        const response = await this.options.onServerRequest?.({
          method: 'item/tool/call',
          id: 'request-2',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            callId: 'tool-1',
            tool: 'Task',
            arguments: { subagent_type: 'researcher', prompt: 'inspect the repo' },
          },
        });
        this.dynamicToolResponses.push(response);
        this.options.onNotification?.({
          method: 'turn/completed',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
        });
        return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
      });
    }

    FakeCodexAppServerClient.instances.length = 0;
    const onClientToolCall = vi.fn().mockResolvedValue({
      handled: true,
      success: true,
      content: 'subagent completed',
    });
    const lib = new CodexAppServerLib(undefined, (options) => new DynamicToolClient(options) as never, {
      sessionMapPath: makeSessionMapPath(),
    });

    await lib.execute('run-client-tool', {
      prompt: 'call dynamic tool',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: ['/tmp/project'],
      readOnlyPaths: [],
      readOnly: false,
    }, {
      onClientToolCall,
    });

    expect(onClientToolCall).toHaveBeenCalledWith({
      toolName: 'Task',
      toolUseId: 'tool-1',
      toolInput: {
        subagent_type: 'researcher',
        prompt: 'inspect the repo',
      },
      signal: expect.any(AbortSignal),
    });
    expect((FakeCodexAppServerClient.instances[0] as DynamicToolClient).dynamicToolResponses).toEqual([
      {
        success: true,
        contentItems: [{ type: 'inputText', text: 'subagent completed' }],
      },
    ]);
  });

  it('maps requestUserInput server requests to onQuestionRequest answers', async () => {
    class QuestionClient extends FakeCodexAppServerClient {
      questionResponses: unknown[] = [];

      override readonly turnStart = vi.fn(async (): Promise<CodexAppServerTurnStartResponse> => {
        this.options.onNotification?.({
          method: 'turn/started',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'inProgress', error: null } },
        });
        const response = await this.options.onServerRequest?.({
          method: 'item/tool/requestUserInput',
          id: 'request-3',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'question-1',
            questions: [
              {
                id: 'priority',
                header: 'Priority',
                question: 'Which priority should I use?',
                options: [
                  { label: 'High', description: 'Ship it now' },
                  { label: 'Low', description: 'Can wait' },
                ],
              },
            ],
          },
        });
        this.questionResponses.push(response);
        this.options.onNotification?.({
          method: 'turn/completed',
          params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null } },
        });
        return { turn: { id: 'turn-1', status: 'inProgress', error: null } };
      });
    }

    FakeCodexAppServerClient.instances.length = 0;
    const onQuestionRequest = vi.fn().mockResolvedValue({ priority: ['High'] });
    const lib = new CodexAppServerLib(undefined, (options) => new QuestionClient(options) as never, {
      sessionMapPath: makeSessionMapPath(),
    });

    await lib.execute('run-question', {
      prompt: 'ask a question',
      cwd: '/tmp/project',
      model: 'gpt-5.4',
      maxTurns: 4,
      timeoutMs: 5000,
      allowedPaths: ['/tmp/project'],
      readOnlyPaths: [],
      readOnly: false,
    }, {
      onQuestionRequest,
    });

    expect(onQuestionRequest).toHaveBeenCalledWith({
      questionId: 'question-1',
      questions: [
        {
          question: 'Which priority should I use?',
          header: 'Priority',
          options: [
            { label: 'High', description: 'Ship it now' },
            { label: 'Low', description: 'Can wait' },
          ],
        },
      ],
    });
    expect((FakeCodexAppServerClient.instances[0] as QuestionClient).questionResponses).toEqual([
      {
        answers: {
          priority: { answers: ['High'] },
        },
      },
    ]);
  });
});
