import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentContext, AgentConfig } from '../../src/shared/types';
import type {
  IAgentLib,
  AgentLibFeatures,
  AgentLibRunOptions,
  AgentLibCallbacks,
  AgentLibResult,
  AgentLibTelemetry,
  AgentLibModelOption,
} from '../../src/core/interfaces/agent-lib';
import type { BaseAgentPromptBuilder, AgentExecutionConfig } from '../../src/core/agents/base-agent-prompt-builder';
import { Agent } from '../../src/core/agents/agent';
import { AgentLibRegistry } from '../../src/core/services/agent-lib-registry';

// Suppress app-logger output in tests
vi.mock('../../src/core/services/app-logger', () => ({
  getAppLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================
// MockAgentLib — implements IAgentLib directly
// ============================================

class MockAgentLib implements IAgentLib {
  readonly name: string;
  executeResult: AgentLibResult = {
    exitCode: 0,
    output: 'Agent output',
    model: 'test-model',
  };

  executeCalls: Array<{ runId: string; options: AgentLibRunOptions; callbacks: AgentLibCallbacks }> = [];
  stopCalls: string[] = [];
  telemetryMap = new Map<string, AgentLibTelemetry>();

  private featuresValue: AgentLibFeatures = { images: false, hooks: false, thinking: false, nativeResume: false, streamingInput: false };

  constructor(name = 'test-engine', features?: Partial<AgentLibFeatures>) {
    this.name = name;
    if (features) this.featuresValue = { ...this.featuresValue, ...features };
  }

  supportedFeatures(): AgentLibFeatures { return this.featuresValue; }
  getDefaultModel(): string { return 'test-model'; }
  getSupportedModels(): AgentLibModelOption[] { return [{ value: 'test-model', label: 'Test Model' }]; }
  async isAvailable(): Promise<boolean> { return true; }

  async execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult> {
    this.executeCalls.push({ runId, options, callbacks });
    // Simulate output streaming
    if (this.executeResult.output) {
      callbacks.onOutput?.(this.executeResult.output);
    }
    return this.executeResult;
  }

  async stop(runId: string): Promise<void> {
    this.stopCalls.push(runId);
  }

  getTelemetry(runId: string): AgentLibTelemetry | null {
    return this.telemetryMap.get(runId) ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  injectMessage(_runId: string, _message: string, _images?: Array<{ base64: string; mediaType: string }>): boolean {
    return false;
  }
}

// ============================================
// MockPromptBuilder — extends BaseAgentPromptBuilder
// ============================================

class MockPromptBuilder {
  readonly type = 'test-builder';
  builtPrompt = 'Built test prompt';
  inferredOutcome = 'success';

  buildPrompt(_context: AgentContext): string { return this.builtPrompt; }
  inferOutcome(_mode: string, exitCode: number, _output: string): string {
    return exitCode === 0 ? this.inferredOutcome : 'failed';
  }
  protected isReadOnly(): boolean { return false; }
  protected getMaxTurns(): number { return 50; }
  protected getOutputFormat(): object | undefined { return undefined; }
  protected getTimeout(_context: AgentContext, config: AgentConfig): number {
    return config.timeout || 60_000;
  }
  protected getExcludedFeedbackTypes(): string[] { return []; }

  buildExecutionConfig(_context: AgentContext, config: AgentConfig): AgentExecutionConfig {
    return {
      prompt: this.builtPrompt,
      maxTurns: 50,
      timeoutMs: config.timeout || 60_000,
      readOnly: false,
    };
  }

  buildResult(_context: AgentContext, libResult: AgentLibResult, outcome: string, prompt: string) {
    let effectiveOutcome = outcome;
    let payload: Record<string, unknown> | undefined;

    // Replicate BaseAgentPromptBuilder.buildResult needs_info override
    if (libResult.exitCode === 0
      && libResult.structuredOutput?.outcome === 'needs_info'
      && Array.isArray(libResult.structuredOutput?.questions)
      && (libResult.structuredOutput.questions as unknown[]).length > 0
    ) {
      effectiveOutcome = 'needs_info';
      payload = { questions: libResult.structuredOutput.questions };
    }

    const result: Record<string, unknown> = {
      exitCode: libResult.exitCode,
      output: libResult.output,
      outcome: effectiveOutcome,
      error: libResult.error,
      costInputTokens: libResult.costInputTokens,
      costOutputTokens: libResult.costOutputTokens,
      cacheReadInputTokens: libResult.cacheReadInputTokens,
      cacheCreationInputTokens: libResult.cacheCreationInputTokens,
      totalCostUsd: libResult.totalCostUsd,
      model: libResult.model,
      structuredOutput: libResult.structuredOutput,
      prompt,
      killReason: libResult.killReason,
      rawExitCode: libResult.rawExitCode,
    };
    if (payload) result.payload = payload;
    return result;
  }
}

// ============================================
// Helpers
// ============================================

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    task: { id: 'task-1', title: 'Test Task', projectId: 'proj-1', pipelineId: 'pipe-1', status: 'in_progress' } as AgentContext['task'],
    mode: 'new',
    workdir: '/tmp/project',
    ...overrides,
  } as AgentContext;
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    timeout: 60_000,
    engine: 'test-engine',
    ...overrides,
  } as AgentConfig;
}

function buildAgent(mockLib?: MockAgentLib, promptBuilder?: MockPromptBuilder, engineName = 'test-engine'): {
  agent: Agent;
  lib: MockAgentLib;
  promptBuilder: MockPromptBuilder;
  registry: AgentLibRegistry;
} {
  const lib = mockLib ?? new MockAgentLib(engineName);
  const builder = promptBuilder ?? new MockPromptBuilder();
  const registry = new AgentLibRegistry();
  registry.register(lib);
  const agent = new Agent('test-agent', builder as unknown as BaseAgentPromptBuilder, registry, engineName);
  return { agent, lib, promptBuilder: builder, registry };
}

// ============================================
// Tests
// ============================================

describe('Agent (integration with BaseAgentLib)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================
  // Core execution flow
  // ============================================

  describe('execute — core flow', () => {
    it('builds prompt via PromptBuilder and passes to lib.execute()', async () => {
      const { agent, lib, promptBuilder } = buildAgent();
      promptBuilder.builtPrompt = 'Custom built prompt';
      const onPromptBuilt = vi.fn();

      await agent.execute(makeContext(), makeConfig(), undefined, undefined, onPromptBuilt);

      expect(onPromptBuilt).toHaveBeenCalledWith('Custom built prompt');
      expect(lib.executeCalls[0].options.prompt).toBe('Custom built prompt');
    });

    it('resolves lib from registry using config.engine', async () => {
      const lib1 = new MockAgentLib('engine-a');
      const lib2 = new MockAgentLib('engine-b');
      const builder = new MockPromptBuilder();
      const registry = new AgentLibRegistry();
      registry.register(lib1);
      registry.register(lib2);
      const agent = new Agent('test-agent', builder as unknown as BaseAgentPromptBuilder, registry, 'engine-a');

      await agent.execute(makeContext(), makeConfig({ engine: 'engine-b' }), undefined, undefined);

      expect(lib2.executeCalls).toHaveLength(1);
      expect(lib1.executeCalls).toHaveLength(0);
    });

    it('defaults to claude-code engine when config.engine is not set', async () => {
      // Agent.execute uses config.engine ?? 'claude-code'
      const claudeLib = new MockAgentLib('claude-code');
      const builder = new MockPromptBuilder();
      const registry = new AgentLibRegistry();
      registry.register(claudeLib);
      const agent = new Agent('test-agent', builder as unknown as BaseAgentPromptBuilder, registry);

      await agent.execute(makeContext(), makeConfig({ engine: undefined }));

      expect(claudeLib.executeCalls).toHaveLength(1);
    });

    it('returns AgentRunResult with correct outcome from inferOutcome', async () => {
      const { agent, lib } = buildAgent();
      lib.executeResult = { exitCode: 0, output: 'done', model: 'test-model' };

      const result = await agent.execute(makeContext(), makeConfig());

      expect(result.exitCode).toBe(0);
      expect(result.outcome).toBe('success');
    });

    it('returns failed outcome on non-zero exit code', async () => {
      const { agent, lib } = buildAgent();
      lib.executeResult = { exitCode: 1, output: 'error', error: 'crash', model: 'test-model' };

      const result = await agent.execute(makeContext(), makeConfig());

      expect(result.exitCode).toBe(1);
      expect(result.outcome).toBe('failed');
    });

    it('passes workdir as allowedPaths and cwd', async () => {
      const { agent, lib } = buildAgent();

      await agent.execute(makeContext({ workdir: '/my/workdir' }), makeConfig());

      expect(lib.executeCalls[0].options.cwd).toBe('/my/workdir');
      expect(lib.executeCalls[0].options.allowedPaths).toContain('/my/workdir');
    });

    it('passes config.model to lib options', async () => {
      const { agent, lib } = buildAgent();

      await agent.execute(makeContext(), makeConfig({ model: 'opus-4.6' }));

      expect(lib.executeCalls[0].options.model).toBe('opus-4.6');
    });
  });

  // ============================================
  // Structured output override
  // ============================================

  describe('execute — structured output', () => {
    it('needs_info structured output overrides outcome', async () => {
      const { agent, lib } = buildAgent();
      lib.executeResult = {
        exitCode: 0,
        output: 'I need more info',
        model: 'test-model',
        structuredOutput: { outcome: 'needs_info', questions: ['What is the API key?'] },
      };

      const result = await agent.execute(makeContext(), makeConfig());

      expect(result.outcome).toBe('needs_info');
      expect(result.payload).toEqual({ questions: ['What is the API key?'] });
    });

    it('needs_info with empty questions array does not override', async () => {
      const { agent, lib } = buildAgent();
      lib.executeResult = {
        exitCode: 0,
        output: 'done',
        model: 'test-model',
        structuredOutput: { outcome: 'needs_info', questions: [] },
      };

      const result = await agent.execute(makeContext(), makeConfig());

      expect(result.outcome).toBe('success');
    });
  });

  // ============================================
  // Session resume — continuation prompt
  // ============================================

  describe('execute — session resume', () => {
    it('uses continuation prompt for native-resume engine on crash recovery resume', async () => {
      const lib = new MockAgentLib('test-engine', { nativeResume: true });
      const { agent } = buildAgent(lib);

      await agent.execute(
        makeContext({ resumedFromRunId: 'prev-run-1', resumeSession: true, sessionId: 'session-1' }),
        makeConfig(),
      );

      // Should use the default continuation prompt, not the full built prompt
      expect(lib.executeCalls[0].options.prompt).toContain('interrupted');
      expect(lib.executeCalls[0].options.prompt).toContain('Continue');
    });

    it('uses customPrompt for continuation when provided', async () => {
      const lib = new MockAgentLib('test-engine', { nativeResume: true });
      const { agent } = buildAgent(lib);

      await agent.execute(
        makeContext({ resumedFromRunId: 'prev-run-1', resumeSession: true, customPrompt: 'Keep going with the refactor' }),
        makeConfig(),
      );

      expect(lib.executeCalls[0].options.prompt).toBe('Keep going with the refactor');
    });

    it('does NOT use continuation prompt when engine lacks nativeResume', async () => {
      const lib = new MockAgentLib('test-engine', { nativeResume: false });
      const { agent, promptBuilder } = buildAgent(lib);
      promptBuilder.builtPrompt = 'Full system prompt';

      await agent.execute(
        makeContext({ resumedFromRunId: 'prev-run-1', resumeSession: true }),
        makeConfig(),
      );

      // Should use the full prompt, not a continuation
      expect(lib.executeCalls[0].options.prompt).toBe('Full system prompt');
    });

    it('passes sessionId and resumeSession through to lib', async () => {
      const { agent, lib } = buildAgent();

      await agent.execute(
        makeContext({ sessionId: 'session-abc', resumeSession: true }),
        makeConfig(),
      );

      expect(lib.executeCalls[0].options.sessionId).toBe('session-abc');
      expect(lib.executeCalls[0].options.resumeSession).toBe(true);
    });
  });

  // ============================================
  // Session resume failure detection and retry
  // ============================================

  describe('execute — session resume failure retry', () => {
    it('retries with full prompt when session resume fails', async () => {
      const { agent, lib, promptBuilder } = buildAgent();
      promptBuilder.builtPrompt = 'Full system prompt';

      // First call: resume failure. Second call: success.
      let callCount = 0;
      const originalExecute = lib.execute.bind(lib);
      lib.execute = vi.fn(async (runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks) => {
        callCount++;
        if (callCount === 1) {
          return {
            exitCode: 1,
            output: 'Session resume failed (session "abc"): session file not found',
            error: 'Session resume failed (session "abc"): session file not found',
            model: 'test-model',
          };
        }
        return originalExecute(runId, options, callbacks);
      });

      const result = await agent.execute(
        makeContext({ resumeSession: true, sessionId: 'abc' }),
        makeConfig(),
      );

      expect(lib.execute).toHaveBeenCalledTimes(2);
      // Second call should have resumeSession: false
      const secondCallOpts = (lib.execute as ReturnType<typeof vi.fn>).mock.calls[1][1] as AgentLibRunOptions;
      expect(secondCallOpts.resumeSession).toBe(false);
      expect(secondCallOpts.prompt).toBe('Full system prompt');
      expect(result.exitCode).toBe(0);
    });

    it('does NOT retry when error does not mention "session"', async () => {
      const { agent, lib } = buildAgent();
      lib.execute = vi.fn(async () => ({
        exitCode: 1,
        output: 'API key invalid',
        error: 'API key invalid',
        model: 'test-model',
      }));

      await agent.execute(makeContext({ resumeSession: true }), makeConfig());

      expect(lib.execute).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry when tokens were consumed', async () => {
      const { agent, lib } = buildAgent();
      lib.execute = vi.fn(async () => ({
        exitCode: 1,
        output: 'Session error',
        error: 'Session resume failed',
        costInputTokens: 100,
        model: 'test-model',
      }));

      await agent.execute(makeContext({ resumeSession: true }), makeConfig());

      expect(lib.execute).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry when killReason is set', async () => {
      const { agent, lib } = buildAgent();
      lib.execute = vi.fn(async () => ({
        exitCode: 1,
        output: 'Session timeout',
        error: 'Agent timed out during session resume',
        killReason: 'timeout',
        model: 'test-model',
      }));

      await agent.execute(makeContext({ resumeSession: true }), makeConfig());

      expect(lib.execute).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry when resumeSession is false', async () => {
      const { agent, lib } = buildAgent();
      lib.execute = vi.fn(async () => ({
        exitCode: 1,
        output: 'Session error',
        error: 'Session file corrupt',
        model: 'test-model',
      }));

      await agent.execute(makeContext({ resumeSession: false }), makeConfig());

      expect(lib.execute).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================
  // Telemetry polling
  // ============================================

  describe('telemetry', () => {
    it('polls getTelemetry periodically and exposes accumulated values', async () => {
      const { agent, lib } = buildAgent();

      // Set up telemetry that the lib will return
      lib.telemetryMap.set('task-1', {
        accumulatedInputTokens: 300,
        accumulatedOutputTokens: 150,
        accumulatedCacheReadInputTokens: 0,
        accumulatedCacheCreationInputTokens: 0,
        messageCount: 5,
        timeout: 60000,
        maxTurns: 50,
      });

      // Make execute block so we can test telemetry mid-run
      let resolveExecute: () => void;
      lib.execute = vi.fn(async (runId: string, _options: AgentLibRunOptions, _callbacks: AgentLibCallbacks) => {
        lib.telemetryMap.set(runId, {
          accumulatedInputTokens: 300,
          accumulatedOutputTokens: 150,
          accumulatedCacheReadInputTokens: 0,
          accumulatedCacheCreationInputTokens: 0,
          messageCount: 5,
          timeout: 60000,
          maxTurns: 50,
        });
        await new Promise<void>(r => { resolveExecute = r; });
        return { exitCode: 0, output: 'done', model: 'test-model' };
      });

      const executePromise = agent.execute(makeContext(), makeConfig());

      // Advance timer to trigger telemetry poll
      await vi.advanceTimersByTimeAsync(600);

      expect(agent.accumulatedInputTokens).toBe(300);
      expect(agent.accumulatedOutputTokens).toBe(150);
      expect(agent.lastMessageCount).toBe(5);

      resolveExecute!();
      await executePromise;
    });
  });

  // ============================================
  // Stop
  // ============================================

  describe('stop', () => {
    it('delegates to lib.stop() for active run', async () => {
      const { agent, lib } = buildAgent();

      let resolveExecute: () => void;
      lib.execute = vi.fn(async () => {
        await new Promise<void>(r => { resolveExecute = r; });
        return { exitCode: 0, output: 'done', model: 'test-model' };
      });

      const executePromise = agent.execute(makeContext(), makeConfig());

      // Wait for execute to start
      await vi.advanceTimersByTimeAsync(10);

      await agent.stop('task-1');

      expect(lib.stopCalls).toContain('task-1');

      resolveExecute!();
      await executePromise;
    });

    it('stop on unknown runId logs warning but does not throw', async () => {
      const { agent } = buildAgent();
      await agent.stop('nonexistent');
      // Should not throw
    });
  });

  // ============================================
  // isAvailable
  // ============================================

  describe('isAvailable', () => {
    it('delegates to the default engine lib', async () => {
      const { agent } = buildAgent();
      const available = await agent.isAvailable();
      expect(available).toBe(true);
    });
  });
});
