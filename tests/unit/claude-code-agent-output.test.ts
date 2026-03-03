import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImplementorPromptBuilder } from '../../src/core/agents/implementor-prompt-builder';
import { ClaudeCodeLib } from '../../src/core/libs/claude-code-lib';
import { Agent } from '../../src/core/agents/agent';
import { AgentLibRegistry } from '../../src/core/services/agent-lib-registry';
import type { AgentContext } from '../../src/shared/types';

function createContext(taskId: string = 'test-task'): AgentContext {
  return {
    task: { id: taskId, title: 'Test task', projectId: 'proj-1', pipelineId: 'pipe-1', status: 'planning', priority: 0, tags: [], metadata: {}, createdAt: Date.now(), updatedAt: Date.now() },
    mode: 'new',
    workdir: '/tmp/test',
    project: { id: 'proj-1', name: 'Test', path: '/tmp/test', description: null, config: {}, createdAt: Date.now(), updatedAt: Date.now() },
  };
}

interface SdkStreamMessage { type: string; subtype?: string; message?: { content: { type: string; text?: string; name?: string; input?: unknown; id?: string }[] }; result?: string; errors?: string[]; structured_output?: Record<string, unknown>; usage?: { input_tokens: number; output_tokens: number }; summary?: string }

// Helper to create a mock async generator from an array of messages
async function* mockQueryGenerator(messages: SdkStreamMessage[]) {
  for (const msg of messages) {
    yield msg;
  }
}

describe('Agent (ImplementorPromptBuilder + ClaudeCodeLib) onOutput streaming', () => {
  let agent: Agent;
  let lib: ClaudeCodeLib;
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    lib = new ClaudeCodeLib();
    const registry = new AgentLibRegistry();
    registry.register(lib);
    agent = new Agent('implementor', new ImplementorPromptBuilder(), registry);
    mockQuery = vi.fn();

    // Mock the private loadQuery method on the lib to return our mock
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(lib as any, 'loadQuery').mockResolvedValue(mockQuery);
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
    expect(result.outcome).toBe('pr_ready');
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

  it('should prefer authoritative result-message tokens over accumulated totals', async () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Step 1' }],
          usage: { input_tokens: 1000, output_tokens: 200 },
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Step 2' }],
          usage: { input_tokens: 2000, output_tokens: 500 },
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Step 3' }],
          usage: { input_tokens: 1500, output_tokens: 300 },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'Done',
        // Result message carries the authoritative cumulative total
        usage: { input_tokens: 4500, output_tokens: 1000 },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const result = await agent.execute(createContext(), {});

    // Should use the result message's authoritative totals
    expect(result.costInputTokens).toBe(4500);
    expect(result.costOutputTokens).toBe(1000);
    expect(result.exitCode).toBe(0);
  });

  it('should deduplicate assistant messages with the same id', async () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          id: 'msg_001',
          content: [{ type: 'text', text: 'Step 1' }],
          usage: { input_tokens: 1000, output_tokens: 200 },
        },
      },
      {
        // Duplicate from parallel tool call — same id, same usage
        type: 'assistant',
        message: {
          id: 'msg_001',
          content: [{ type: 'tool_use', name: 'bash', input: {} }],
          usage: { input_tokens: 1000, output_tokens: 200 },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'Done',
        // No usage on result — forces fallback to accumulated
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const result = await agent.execute(createContext(), {});

    // Should count msg_001 only once: 1000 in, 200 out (not 2000/400)
    expect(result.costInputTokens).toBe(1000);
    expect(result.costOutputTokens).toBe(200);
  });

  it('should fall back to result-message tokens when no assistant messages have usage', async () => {
    const messages = [
      {
        type: 'result',
        subtype: 'success',
        result: 'Done',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const result = await agent.execute(createContext(), {});

    // No assistant messages → accumulated is 0, so fall back to result values
    expect(result.costInputTokens).toBe(100);
    expect(result.costOutputTokens).toBe(50);
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
