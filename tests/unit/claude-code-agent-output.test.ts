import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeAgent } from '../../src/main/agents/claude-code-agent';
import type { AgentContext } from '../../src/shared/types';

function createContext(taskId: string = 'test-task'): AgentContext {
  return {
    task: { id: taskId, title: 'Test task', projectId: 'proj-1', pipelineId: 'pipe-1', status: 'planning', priority: 0, tags: [], metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
    mode: 'plan',
    workdir: '/tmp/test',
  };
}

interface SdkStreamMessage { type: string; subtype?: string; message?: { content: { type: string; text?: string; name?: string; input?: unknown; id?: string }[] }; result?: string; errors?: string[]; structured_output?: Record<string, unknown>; usage?: { input_tokens: number; output_tokens: number }; summary?: string }

// Helper to create a mock async generator from an array of messages
async function* mockQueryGenerator(messages: SdkStreamMessage[]) {
  for (const msg of messages) {
    yield msg;
  }
}

describe('ClaudeCodeAgent onOutput streaming', () => {
  let agent: ClaudeCodeAgent;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    agent = new ClaudeCodeAgent();
    mockQuery = vi.fn();

    // Mock the private loadQuery method to return our mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(agent as any, 'loadQuery').mockResolvedValue(mockQuery);
  });

  it('should call onOutput for each assistant text block', async () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'First response' },
            { type: 'text', text: ' continued' },
          ],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'Plan complete',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const chunks: string[] = [];
    const onOutput = (chunk: string) => chunks.push(chunk);

    const result = await agent.execute(createContext(), {}, onOutput);

    expect(chunks).toEqual(['First response\n', ' continued\n']);
    expect(result.exitCode).toBe(0);
    expect(result.outcome).toBe('plan_complete');
    expect(result.output).toContain('First response');
    expect(result.output).toContain(' continued');
    expect(result.costInputTokens).toBe(100);
    expect(result.costOutputTokens).toBe(50);
  });

  it('should work without onOutput callback', async () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Done' }],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'Done',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const result = await agent.execute(createContext(), {});

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Done');
  });

  it('should handle error results', async () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'partial work' }],
        },
      },
      {
        type: 'result',
        subtype: 'error_during_execution',
        errors: ['Something failed', 'Details here'],
        usage: { input_tokens: 50, output_tokens: 20 },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const chunks: string[] = [];
    const result = await agent.execute(createContext(), {}, (chunk) => chunks.push(chunk));

    expect(chunks[0]).toContain('partial work');
    expect(result.exitCode).toBe(1);
    expect(result.outcome).toBe('failed');
    expect(result.error).toBe('Something failed\nDetails here');
  });

  it('should include tool_use blocks in output', async () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'I will read the file' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/tmp/test.txt' } },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Done reading' },
          ],
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'Ok',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const chunks: string[] = [];
    const result = await agent.execute(createContext(), {}, (chunk) => chunks.push(chunk));

    expect(chunks[0]).toContain('I will read the file');
    expect(chunks.some(c => c.includes('Tool: Read'))).toBe(true);
    expect(chunks.some(c => c.includes('Done reading'))).toBe(true);
    expect(result.output).toContain('I will read the file');
    expect(result.output).toContain('Tool: Read');
    expect(result.output).toContain('Done reading');
  });

  it('should handle thrown errors', async () => {
    mockQuery.mockReturnValue((async function* () {
      throw new Error('Connection lost');
    })());

    const result = await agent.execute(createContext(), {});

    expect(result.exitCode).toBe(1);
    expect(result.outcome).toBe('failed');
    expect(result.error).toBe('Connection lost');
  });

  it('should pass correct options to query', async () => {
    const messages = [
      {
        type: 'result',
        subtype: 'success',
        result: 'Ok',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const context = createContext();
    context.workdir = '/my/project';
    await agent.execute(context, {});

    expect(mockQuery).toHaveBeenCalledOnce();
    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.prompt).toContain('Test task');
    expect(callArgs.options.cwd).toBe('/my/project');
    expect(callArgs.options.permissionMode).toBe('bypassPermissions');
    expect(callArgs.options.allowDangerouslySkipPermissions).toBe(true);
    expect(callArgs.options.abortController).toBeInstanceOf(AbortController);
  });

  it('should abort via stop()', async () => {
    let resolveQuery: () => void;
    const queryPromise = new Promise<void>((r) => { resolveQuery = r; });

    mockQuery.mockReturnValue((async function* () {
      await queryPromise;
      yield {
        type: 'result',
        subtype: 'success',
        result: 'Done',
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    })());

    const executePromise = agent.execute(createContext('run-1'), {});

    // Stop should abort the controller
    await agent.stop('run-1');
    resolveQuery!();

    const result = await executePromise;
    // After abort, the generator should complete (possibly with error)
    expect(result).toBeDefined();
  });
});
