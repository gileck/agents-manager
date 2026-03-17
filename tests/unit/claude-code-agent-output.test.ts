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

interface SdkStreamMessage { type: string; subtype?: string; message?: { content: { type: string; text?: string; name?: string; input?: unknown; id?: string }[] }; result?: string; errors?: string[]; structured_output?: Record<string, unknown>; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }; summary?: string; modelUsage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number; contextWindow?: number; maxOutputTokens?: number }> }

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

    // Streaming chunks include both assistant text and tool calls
    expect(chunks[0]).toContain('I will read the file');
    expect(chunks.some(c => c.includes('Tool: Read'))).toBe(true);
    expect(chunks.some(c => c.includes('Done reading'))).toBe(true);
    // Stored output only includes assistant text, not tool call details
    expect(result.output).toContain('I will read the file');
    expect(result.output).not.toContain('Tool: Read');
    expect(result.output).toContain('Done reading');
  });

  it('should handle thrown errors', async () => {
    mockQuery.mockReturnValue((async function* () {
      throw new Error('Connection lost');
    })());

    const result = await agent.execute(createContext(), {});

    expect(result.exitCode).toBe(1);
    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('Connection lost');
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
    // Prompt is a string (Single Message Input mode) when no images attached
    expect(typeof callArgs.prompt).toBe('string');
    expect(callArgs.prompt).toContain('Test task');
    expect(callArgs.options.cwd).toBe('/my/project');
    expect(callArgs.options.permissionMode).toBe('acceptEdits');
    expect(callArgs.options.allowDangerouslySkipPermissions).toBeUndefined();
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

  it('should sum tokens from modelUsage across multiple models (including subagent usage)', async () => {
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
        usage: { input_tokens: 3000, output_tokens: 800 },
        modelUsage: {
          'claude-opus-4-6': {
            inputTokens: 3000,
            outputTokens: 800,
            cacheReadInputTokens: 500,
            cacheCreationInputTokens: 200,
            costUSD: 0.10,
            contextWindow: 200000,
            maxOutputTokens: 16384,
          },
          'claude-haiku-4-5-20251001': {
            inputTokens: 50000,
            outputTokens: 12000,
            cacheReadInputTokens: 8000,
            cacheCreationInputTokens: 1000,
            costUSD: 0.05,
          },
        },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const result = await agent.execute(createContext(), {});

    // Should sum across all models: parent (opus) + subagent (haiku)
    expect(result.costInputTokens).toBe(53000);
    expect(result.costOutputTokens).toBe(12800);
    expect(result.cacheReadInputTokens).toBe(8500);
    expect(result.cacheCreationInputTokens).toBe(1200);
  });

  it('should prefer modelUsage over result.usage when both are present', async () => {
    const messages = [
      {
        type: 'result',
        subtype: 'success',
        result: 'Done',
        // result.usage has parent-only counts
        usage: { input_tokens: 3000, output_tokens: 800 },
        // modelUsage has comprehensive counts (parent + subagent)
        modelUsage: {
          'claude-opus-4-6': {
            inputTokens: 3000,
            outputTokens: 800,
            cacheReadInputTokens: 100,
            cacheCreationInputTokens: 50,
            costUSD: 0.10,
          },
          'claude-sonnet-4-6': {
            inputTokens: 7000,
            outputTokens: 2200,
            cacheReadInputTokens: 400,
            cacheCreationInputTokens: 150,
            costUSD: 0.08,
          },
        },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const result = await agent.execute(createContext(), {});

    // modelUsage wins — includes subagent tokens
    expect(result.costInputTokens).toBe(10000);
    expect(result.costOutputTokens).toBe(3000);
    expect(result.cacheReadInputTokens).toBe(500);
    expect(result.cacheCreationInputTokens).toBe(200);
  });

  it('should fall back to result.usage when modelUsage is empty', async () => {
    const messages = [
      {
        type: 'result',
        subtype: 'success',
        result: 'Done',
        usage: { input_tokens: 2000, output_tokens: 600 },
        modelUsage: {},
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const result = await agent.execute(createContext(), {});

    // Empty modelUsage → falls back to result.usage
    expect(result.costInputTokens).toBe(2000);
    expect(result.costOutputTokens).toBe(600);
  });

  it('should fall back to result.usage when modelUsage is not present', async () => {
    const messages = [
      {
        type: 'result',
        subtype: 'success',
        result: 'Done',
        usage: { input_tokens: 1500, output_tokens: 400 },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const result = await agent.execute(createContext(), {});

    // No modelUsage → falls back to result.usage (existing behavior preserved)
    expect(result.costInputTokens).toBe(1500);
    expect(result.costOutputTokens).toBe(400);
  });

  it('should include turn limit in error message for error_max_turns', async () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Working on it...' }],
        },
      },
      {
        type: 'result',
        subtype: 'error_max_turns',
        usage: { input_tokens: 500, output_tokens: 200 },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const result = await agent.execute(createContext(), {});

    expect(result.exitCode).toBe(1);
    expect(result.outcome).toBe('failed');
    expect(result.error).toContain('maximum turn limit');
    expect(result.error).toContain('turns');
  });

  it('should provide descriptive error message for non-success subtypes', async () => {
    const messages = [
      {
        type: 'result',
        subtype: 'error_during_execution',
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    ];

    mockQuery.mockReturnValue(mockQueryGenerator(messages));

    const result = await agent.execute(createContext(), {});

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('error_during_execution');
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
