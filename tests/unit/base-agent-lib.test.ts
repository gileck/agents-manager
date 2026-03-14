import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  AgentLibFeatures,
  AgentLibModelOption,
  AgentLibRunOptions,
  AgentLibCallbacks,
  AgentLibHooks,
} from '../../src/core/interfaces/agent-lib';
import type { ISessionHistoryProvider } from '../../src/core/interfaces/session-history-provider';
import { BaseAgentLib, type BaseRunState, type EngineRunOptions, type EngineResult } from '../../src/core/libs/base-agent-lib';

// Mock fs.realpathSync for SandboxGuard (avoids filesystem dependency)
vi.mock('fs', () => ({
  realpathSync: (p: string) => p,
}));

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
// TestAgentLib — configurable stub
// ============================================

class TestAgentLib extends BaseAgentLib {
  readonly name = 'test-engine';

  engineResult: EngineResult | ((opts: EngineRunOptions, state: BaseRunState) => EngineResult | Promise<EngineResult>) = { isError: false };
  features: AgentLibFeatures = { images: false, hooks: false, thinking: false, nativeResume: false };
  defaultModel = 'test-model';
  available = true;

  // Spy tracking
  runEngineCalls: Array<{ runId: string; state: BaseRunState; opts: EngineRunOptions }> = [];
  doStopCalls: Array<{ runId: string }> = [];

  // Optional hook to run custom logic inside runEngine (emit, delay, mutate state, etc.)
  onRunEngine?: (runId: string, state: BaseRunState, opts: EngineRunOptions) => void | Promise<void>;

  supportedFeatures(): AgentLibFeatures { return this.features; }
  getDefaultModel(): string { return this.defaultModel; }
  getSupportedModels(): AgentLibModelOption[] { return [{ value: this.defaultModel, label: 'Test Model' }]; }
  async isAvailable(): Promise<boolean> { return this.available; }

  protected async runEngine(runId: string, state: BaseRunState, opts: EngineRunOptions): Promise<EngineResult> {
    this.runEngineCalls.push({ runId, state, opts });
    if (this.onRunEngine) await this.onRunEngine(runId, state, opts);
    if (typeof this.engineResult === 'function') return this.engineResult(opts, state);
    return this.engineResult;
  }

  protected doStop(runId: string, state: BaseRunState): void {
    this.doStopCalls.push({ runId });
    super.doStop(runId, state);
  }

  // Expose protected helpers for direct testing
  public testResolveSessionPrompt(prompt: string, options: AgentLibRunOptions, log: (msg: string) => void) {
    return this.resolveSessionPrompt(prompt, options, log);
  }
  public testBuildDiagnostics(state: BaseRunState, options: AgentLibRunOptions, extra?: Record<string, unknown>) {
    return this.buildDiagnostics(state, options, extra);
  }
}

// ============================================
// Helpers
// ============================================

function makeOptions(overrides: Partial<AgentLibRunOptions> = {}): AgentLibRunOptions {
  return {
    prompt: 'Test prompt',
    cwd: '/tmp/project',
    model: 'test-model',
    maxTurns: 10,
    timeoutMs: 30_000,
    allowedPaths: ['/tmp/project'],
    readOnlyPaths: [],
    readOnly: false,
    ...overrides,
  };
}

function makeCallbacks(overrides: Partial<AgentLibCallbacks> = {}): AgentLibCallbacks {
  return {
    onOutput: vi.fn(),
    onLog: vi.fn(),
    ...overrides,
  };
}

// ============================================
// Tests
// ============================================

describe('BaseAgentLib', () => {
  let lib: TestAgentLib;

  beforeEach(() => {
    vi.useFakeTimers();
    lib = new TestAgentLib();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================
  // Happy path & result assembly
  // ============================================

  describe('execute — happy path and result assembly', () => {
    it('returns exitCode 0 and output from emit() calls on success', async () => {
      lib.onRunEngine = (_runId, _state, opts) => {
        opts.emit('hello ');
        opts.emit('world');
      };
      lib.engineResult = { isError: false };

      const result = await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('hello world');
      expect(result.error).toBeUndefined();
    });

    it('streams emit() chunks to onOutput callback', async () => {
      const onOutput = vi.fn();
      lib.onRunEngine = (_runId, _state, opts) => {
        opts.emit('chunk1');
        opts.emit('chunk2');
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions(), makeCallbacks({ onOutput }));

      expect(onOutput).toHaveBeenCalledWith('chunk1');
      expect(onOutput).toHaveBeenCalledWith('chunk2');
    });

    it('stream() reaches onOutput but is NOT included in result text', async () => {
      const onOutput = vi.fn();
      lib.onRunEngine = (_runId, _state, opts) => {
        opts.emit('persisted');
        opts.stream('transient');
      };
      lib.engineResult = { isError: false };

      const result = await lib.execute('run1', makeOptions(), makeCallbacks({ onOutput }));

      expect(result.output).toBe('persisted');
      expect(onOutput).toHaveBeenCalledWith('transient');
    });

    it('uses fallbackOutput when no emit() called', async () => {
      lib.engineResult = { isError: false, fallbackOutput: 'backup output' };

      const result = await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(result.output).toBe('backup output');
    });

    it('engine token counts take priority over accumulated state', async () => {
      lib.onRunEngine = (_runId, state) => {
        state.accumulatedInputTokens = 100;
        state.accumulatedOutputTokens = 50;
      };
      lib.engineResult = { isError: false, costInputTokens: 200, costOutputTokens: 80 };

      const result = await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(result.costInputTokens).toBe(200);
      expect(result.costOutputTokens).toBe(80);
    });

    it('uses accumulated tokens as fallback when engine does not provide them', async () => {
      lib.onRunEngine = (_runId, state) => {
        state.accumulatedInputTokens = 100;
        state.accumulatedOutputTokens = 50;
      };
      lib.engineResult = { isError: false };

      const result = await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(result.costInputTokens).toBe(100);
      expect(result.costOutputTokens).toBe(50);
    });

    it('passes through all optional EngineResult fields', async () => {
      lib.engineResult = {
        isError: false,
        structuredOutput: { outcome: 'success' },
        contextWindow: 200000,
        maxOutputTokens: 16000,
        durationMs: 5000,
        durationApiMs: 4000,
        numTurns: 3,
        totalCostUsd: 0.05,
        lastContextInputTokens: 1000,
        modelUsage: { 'test-model': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 } },
      };

      const result = await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(result.structuredOutput).toEqual({ outcome: 'success' });
      expect(result.contextWindow).toBe(200000);
      expect(result.maxOutputTokens).toBe(16000);
      expect(result.durationMs).toBe(5000);
      expect(result.durationApiMs).toBe(4000);
      expect(result.numTurns).toBe(3);
      expect(result.totalCostUsd).toBe(0.05);
      expect(result.lastContextInputTokens).toBe(1000);
      expect(result.modelUsage).toBeDefined();
    });

    it('defaults model to getDefaultModel() when options.model is undefined', async () => {
      lib.engineResult = { isError: false };

      const result = await lib.execute('run1', makeOptions({ model: undefined }), makeCallbacks());

      expect(result.model).toBe('test-model');
    });

    it('uses options.model when provided', async () => {
      lib.engineResult = { isError: false };

      const result = await lib.execute('run1', makeOptions({ model: 'custom-model' }), makeCallbacks());

      expect(result.model).toBe('custom-model');
    });

    it('returns error result when engine reports isError', async () => {
      lib.engineResult = { isError: true, errorMessage: 'SDK crashed' };

      const result = await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('SDK crashed');
    });

    it('getResultLength returns current accumulated result text length', async () => {
      let capturedLength = -1;
      lib.onRunEngine = (_runId, _state, opts) => {
        opts.emit('12345');
        capturedLength = opts.getResultLength();
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(capturedLength).toBe(5);
    });
  });

  // ============================================
  // Permission chain
  // ============================================

  describe('execute — permission chain', () => {
    it('sandbox guard blocks writes to paths outside allowedPaths', async () => {
      let canUseToolResult: unknown;
      lib.onRunEngine = async (_runId, state, opts) => {
        canUseToolResult = await opts.canUseTool(
          'Write',
          { file_path: '/home/user/secret.txt' },
          { signal: state.abortController.signal, toolUseID: 'tu1' },
        );
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(canUseToolResult).toEqual({ behavior: 'deny', message: expect.stringContaining('Write outside allowed paths') });
    });

    it('sandbox guard allows writes within allowedPaths', async () => {
      let canUseToolResult: unknown;
      lib.onRunEngine = async (_runId, state, opts) => {
        canUseToolResult = await opts.canUseTool(
          'Write',
          { file_path: '/tmp/project/file.ts' },
          { signal: state.abortController.signal, toolUseID: 'tu1' },
        );
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(canUseToolResult).toEqual({ behavior: 'allow', updatedInput: { file_path: '/tmp/project/file.ts' } });
    });

    it('callerCanUseTool interceptor can deny', async () => {
      let canUseToolResult: unknown;
      const callerCanUseTool = vi.fn().mockResolvedValue({ behavior: 'deny', message: 'blocked by caller' });

      lib.onRunEngine = async (_runId, state, opts) => {
        canUseToolResult = await opts.canUseTool(
          'Write',
          { file_path: '/tmp/project/file.ts' },
          { signal: state.abortController.signal, toolUseID: 'tu1' },
        );
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions({ canUseTool: callerCanUseTool }), makeCallbacks());

      expect(canUseToolResult).toEqual({ behavior: 'deny', message: 'blocked by caller' });
    });

    it('callerCanUseTool interceptor can provide updatedInput', async () => {
      let canUseToolResult: unknown;
      const callerCanUseTool = vi.fn().mockResolvedValue({
        behavior: 'allow',
        updatedInput: { file_path: '/tmp/project/modified.ts' },
      });

      lib.onRunEngine = async (_runId, state, opts) => {
        canUseToolResult = await opts.canUseTool(
          'Write',
          { file_path: '/tmp/project/original.ts' },
          { signal: state.abortController.signal, toolUseID: 'tu1' },
        );
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions({ canUseTool: callerCanUseTool }), makeCallbacks());

      expect(canUseToolResult).toEqual({
        behavior: 'allow',
        updatedInput: { file_path: '/tmp/project/modified.ts' },
      });
    });

    it('callerCanUseTool error is caught and denied gracefully', async () => {
      let canUseToolResult: unknown;
      const callerCanUseTool = vi.fn().mockRejectedValue(new Error('interceptor crash'));

      lib.onRunEngine = async (_runId, state, opts) => {
        canUseToolResult = await opts.canUseTool(
          'Write',
          { file_path: '/tmp/project/file.ts' },
          { signal: state.abortController.signal, toolUseID: 'tu1' },
        );
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions({ canUseTool: callerCanUseTool }), makeCallbacks());

      expect(canUseToolResult).toEqual({
        behavior: 'deny',
        message: 'Tool interceptor failed: interceptor crash',
      });
    });

    it('onPermissionRequest approval allows the tool', async () => {
      let canUseToolResult: unknown;
      const onPermissionRequest = vi.fn().mockResolvedValue({ allowed: true });

      lib.onRunEngine = async (_runId, state, opts) => {
        canUseToolResult = await opts.canUseTool(
          'Write',
          { file_path: '/tmp/project/file.ts' },
          { signal: state.abortController.signal, toolUseID: 'tu1' },
        );
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions(), makeCallbacks({ onPermissionRequest }));

      expect(canUseToolResult).toEqual({ behavior: 'allow', updatedInput: { file_path: '/tmp/project/file.ts' } });
      expect(onPermissionRequest).toHaveBeenCalledWith({
        toolName: 'Write',
        toolInput: { file_path: '/tmp/project/file.ts' },
        toolUseId: 'tu1',
      });
    });

    it('onPermissionRequest denial blocks the tool', async () => {
      let canUseToolResult: unknown;
      const onPermissionRequest = vi.fn().mockResolvedValue({ allowed: false });

      lib.onRunEngine = async (_runId, state, opts) => {
        canUseToolResult = await opts.canUseTool(
          'Write',
          { file_path: '/tmp/project/file.ts' },
          { signal: state.abortController.signal, toolUseID: 'tu1' },
        );
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions(), makeCallbacks({ onPermissionRequest }));

      expect(canUseToolResult).toEqual({ behavior: 'deny', message: 'Denied by user' });
    });

    it('onPermissionRequest error with aborted signal returns "Agent was stopped"', async () => {
      let canUseToolResult: unknown;
      const ac = new AbortController();
      ac.abort(); // pre-abort
      const onPermissionRequest = vi.fn().mockRejectedValue(new Error('aborted'));

      lib.onRunEngine = async (_runId, _state, opts) => {
        // Use a pre-aborted signal to simulate stop during permission request
        canUseToolResult = await opts.canUseTool(
          'Write',
          { file_path: '/tmp/project/file.ts' },
          { signal: ac.signal, toolUseID: 'tu1' },
        );
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions(), makeCallbacks({ onPermissionRequest }));

      expect(canUseToolResult).toEqual({ behavior: 'deny', message: 'Agent was stopped' });
    });

    it('chain executes in order: sandbox guard blocks before caller is called', async () => {
      const callerCanUseTool = vi.fn();
      const onPermissionRequest = vi.fn();

      lib.onRunEngine = async (_runId, state, opts) => {
        await opts.canUseTool(
          'Write',
          { file_path: '/home/user/outside.txt' },
          { signal: state.abortController.signal, toolUseID: 'tu1' },
        );
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions({ canUseTool: callerCanUseTool }), makeCallbacks({ onPermissionRequest }));

      expect(callerCanUseTool).not.toHaveBeenCalled();
      expect(onPermissionRequest).not.toHaveBeenCalled();
    });

    it('allows tool when no onPermissionRequest is set and sandbox + caller pass', async () => {
      let canUseToolResult: unknown;

      lib.onRunEngine = async (_runId, state, opts) => {
        canUseToolResult = await opts.canUseTool(
          'Write',
          { file_path: '/tmp/project/file.ts' },
          { signal: state.abortController.signal, toolUseID: 'tu1' },
        );
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions(), makeCallbacks({ onPermissionRequest: undefined }));

      expect(canUseToolResult).toEqual({ behavior: 'allow', updatedInput: { file_path: '/tmp/project/file.ts' } });
    });
  });

  // ============================================
  // Timeout and abort
  // ============================================

  describe('execute — timeout and abort', () => {
    it('timeout triggers abort and returns killReason: timeout', async () => {
      lib.onRunEngine = async () => {
        // Advance timer past timeout to trigger abort, then throw to simulate SDK abort
        await vi.advanceTimersByTimeAsync(31_000);
        throw new Error('aborted');
      };

      const result = await lib.execute('run1', makeOptions({ timeoutMs: 30_000 }), makeCallbacks());

      expect(result.exitCode).toBe(1);
      expect(result.killReason).toBe('timeout');
      expect(result.error).toContain('timed out');
    });

    it('stop() sets stoppedReason and aborts', async () => {
      lib.onRunEngine = async (_runId, state) => {
        // Wait for the abort signal (fired by stop())
        await new Promise<void>(resolve => {
          state.abortController.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new Error('aborted');
      };

      const resultPromise = lib.execute('run1', makeOptions(), makeCallbacks());
      // Yield to let onRunEngine reach the abort listener wait
      await vi.advanceTimersByTimeAsync(0);
      await lib.stop('run1');
      const result = await resultPromise;

      expect(result.killReason).toBe('stopped');
      expect(lib.doStopCalls).toHaveLength(1);
    });

    it('stop() on unknown runId is a no-op', async () => {
      await lib.stop('nonexistent');
      // Should not throw
    });
  });

  // ============================================
  // Error handling (catch block)
  // ============================================

  describe('execute — error handling', () => {
    it('runEngine throwing returns exitCode 1 with error message', async () => {
      lib.onRunEngine = async () => { throw new Error('SDK crashed'); };

      const result = await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('SDK crashed');
    });

    it('accumulated tokens included in error result', async () => {
      lib.onRunEngine = async (_runId, state) => {
        state.accumulatedInputTokens = 500;
        state.accumulatedOutputTokens = 200;
        throw new Error('crash');
      };

      const result = await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(result.costInputTokens).toBe(500);
      expect(result.costOutputTokens).toBe(200);
    });

    it('partial output preserved in error result', async () => {
      lib.onRunEngine = async (_runId, _state, opts) => {
        opts.emit('partial output before crash');
        throw new Error('crash');
      };

      const result = await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(result.output).toBe('partial output before crash');
    });
  });

  // ============================================
  // State management
  // ============================================

  describe('state management', () => {
    it('getTelemetry returns data during execution, null after', async () => {
      let telemetryDuringRun: unknown;
      lib.onRunEngine = async (_runId) => {
        telemetryDuringRun = lib.getTelemetry('run1');
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions(), makeCallbacks());

      expect(telemetryDuringRun).not.toBeNull();
      expect(lib.getTelemetry('run1')).toBeNull();
    });

    it('getTelemetry reflects accumulated values set by engine', async () => {
      let telemetry: unknown;
      lib.onRunEngine = async (_runId, state) => {
        state.accumulatedInputTokens = 100;
        state.accumulatedOutputTokens = 50;
        state.messageCount = 10;
        telemetry = lib.getTelemetry('run1');
      };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions({ timeoutMs: 60000, maxTurns: 20 }), makeCallbacks());

      expect(telemetry).toEqual({
        accumulatedInputTokens: 100,
        accumulatedOutputTokens: 50,
        accumulatedCacheReadInputTokens: 0,
        accumulatedCacheCreationInputTokens: 0,
        messageCount: 10,
        timeout: 60000,
        maxTurns: 20,
      });
    });

    it('getTelemetry on unknown runId returns null', () => {
      expect(lib.getTelemetry('nonexistent')).toBeNull();
    });

    it('throws on duplicate runId', async () => {
      let resolveFirst: () => void;
      const firstBlocks = new Promise<void>(r => { resolveFirst = r; });

      lib.onRunEngine = async () => {
        await firstBlocks;
      };
      lib.engineResult = { isError: false };

      const firstRun = lib.execute('same-id', makeOptions(), makeCallbacks());

      await expect(lib.execute('same-id', makeOptions(), makeCallbacks())).rejects.toThrow('Duplicate runId');

      resolveFirst!();
      await firstRun;
    });
  });

  // ============================================
  // Session history fallback — resolveSessionPrompt
  // ============================================

  describe('resolveSessionPrompt', () => {
    it('returns original prompt when resumeSession is false', async () => {
      const result = await lib.testResolveSessionPrompt('original', makeOptions({ resumeSession: false }), vi.fn());
      expect(result).toBe('original');
    });

    it('returns original prompt when no sessionHistoryProvider', async () => {
      const libNoProvider = new TestAgentLib();
      const result = await libNoProvider.testResolveSessionPrompt(
        'original',
        makeOptions({ resumeSession: true, taskId: 'task1', agentType: 'test' }),
        vi.fn(),
      );
      expect(result).toBe('original');
    });

    it('returns original prompt when taskId is missing', async () => {
      const mockProvider: ISessionHistoryProvider = { getPreviousMessages: vi.fn() };
      const libWithProvider = new TestAgentLib(mockProvider);
      const result = await libWithProvider.testResolveSessionPrompt(
        'original',
        makeOptions({ resumeSession: true, agentType: 'test' }),
        vi.fn(),
      );
      expect(result).toBe('original');
      expect(mockProvider.getPreviousMessages).not.toHaveBeenCalled();
    });

    it('prepends history when all conditions are met', async () => {
      const mockProvider: ISessionHistoryProvider = {
        getPreviousMessages: vi.fn().mockResolvedValue([
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'Response' },
        ]),
      };
      const libWithProvider = new TestAgentLib(mockProvider);

      const result = await libWithProvider.testResolveSessionPrompt(
        'continuation prompt',
        makeOptions({ resumeSession: true, taskId: 'task1', agentType: 'planner' }),
        vi.fn(),
      );

      expect(result).toContain('continuation prompt');
      expect(result).toContain('---');
      // History should be prepended before the original prompt
      expect(result.indexOf('---')).toBeLessThan(result.indexOf('continuation prompt'));
    });

    it('returns original prompt when provider returns empty array', async () => {
      const mockProvider: ISessionHistoryProvider = {
        getPreviousMessages: vi.fn().mockResolvedValue([]),
      };
      const libWithProvider = new TestAgentLib(mockProvider);

      const result = await libWithProvider.testResolveSessionPrompt(
        'original',
        makeOptions({ resumeSession: true, taskId: 'task1', agentType: 'test' }),
        vi.fn(),
      );
      expect(result).toBe('original');
    });

    it('returns original prompt when provider throws (non-fatal)', async () => {
      const mockProvider: ISessionHistoryProvider = {
        getPreviousMessages: vi.fn().mockRejectedValue(new Error('DB error')),
      };
      const libWithProvider = new TestAgentLib(mockProvider);
      const logFn = vi.fn();

      const result = await libWithProvider.testResolveSessionPrompt(
        'original',
        makeOptions({ resumeSession: true, taskId: 'task1', agentType: 'test' }),
        logFn,
      );

      expect(result).toBe('original');
      expect(logFn).toHaveBeenCalledWith(expect.stringContaining('Failed to load session history'));
    });
  });

  // ============================================
  // Hooks passthrough
  // ============================================

  describe('execute — hooks passthrough', () => {
    it('passes hooks to runEngine when features.hooks is true', async () => {
      lib.features = { images: false, hooks: true, thinking: false, nativeResume: false };
      const hooks: AgentLibHooks = { postToolUse: vi.fn() };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions({ hooks }), makeCallbacks());

      expect(lib.runEngineCalls[0].opts.hooks).toBe(hooks);
    });

    it('does NOT pass hooks to runEngine when features.hooks is false', async () => {
      lib.features = { images: false, hooks: false, thinking: false, nativeResume: false };
      const hooks: AgentLibHooks = { postToolUse: vi.fn() };
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions({ hooks }), makeCallbacks());

      expect(lib.runEngineCalls[0].opts.hooks).toBeUndefined();
    });
  });

  // ============================================
  // Diagnostics builder
  // ============================================

  describe('buildDiagnostics', () => {
    it('includes all state and option fields', () => {
      const state: BaseRunState = {
        abortController: new AbortController(),
        accumulatedInputTokens: 100,
        accumulatedOutputTokens: 50,
        accumulatedCacheReadInputTokens: 0,
        accumulatedCacheCreationInputTokens: 0,
        messageCount: 5,
        timeout: 60000,
        maxTurns: 20,
      };

      const result = lib.testBuildDiagnostics(state, makeOptions({ model: 'opus' }));

      expect(result).toContain('messages_processed: 5');
      expect(result).toContain('cwd: /tmp/project');
      expect(result).toContain('model: opus');
      expect(result).toContain('max_turns: 10');
      expect(result).toContain('timeout: 30s');
      expect(result).toContain('accumulated_tokens: 100/50');
    });

    it('includes extra fields', () => {
      const state: BaseRunState = {
        abortController: new AbortController(),
        accumulatedInputTokens: 0,
        accumulatedOutputTokens: 0,
        accumulatedCacheReadInputTokens: 0,
        accumulatedCacheCreationInputTokens: 0,
        messageCount: 0,
        timeout: 30000,
        maxTurns: 10,
      };

      const result = lib.testBuildDiagnostics(state, makeOptions(), { sdk_error: 'boom', exit_code: 1 });

      expect(result).toContain('sdk_error: boom');
      expect(result).toContain('exit_code: 1');
    });

    it('includes resume_session when set', () => {
      const state: BaseRunState = {
        abortController: new AbortController(),
        accumulatedInputTokens: 0,
        accumulatedOutputTokens: 0,
        accumulatedCacheReadInputTokens: 0,
        accumulatedCacheCreationInputTokens: 0,
        messageCount: 0,
        timeout: 30000,
        maxTurns: 10,
      };

      const result = lib.testBuildDiagnostics(state, makeOptions({ resumeSession: true, sessionId: 'abc-123' }));

      expect(result).toContain('resume_session: abc-123');
    });
  });

  // ============================================
  // Engine receives correct prompt and options
  // ============================================

  describe('execute — engine receives correct arguments', () => {
    it('passes original prompt to runEngine', async () => {
      lib.engineResult = { isError: false };

      await lib.execute('run1', makeOptions({ prompt: 'My test prompt' }), makeCallbacks());

      expect(lib.runEngineCalls[0].opts.prompt).toBe('My test prompt');
    });

    it('passes options and callbacks through to runEngine', async () => {
      lib.engineResult = { isError: false };
      const opts = makeOptions();
      const cbs = makeCallbacks();

      await lib.execute('run1', opts, cbs);

      expect(lib.runEngineCalls[0].opts.options).toBe(opts);
      expect(lib.runEngineCalls[0].opts.callbacks).toBe(cbs);
    });
  });
});
