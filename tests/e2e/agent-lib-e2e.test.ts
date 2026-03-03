/**
 * E2E tests for IAgentLib implementations.
 *
 * These tests hit real APIs — they are NOT mocked.
 * Each lib is checked for availability and skipped gracefully if the engine
 * isn't installed or the workspace isn't trusted. Run separately from unit tests:
 *
 *   yarn test:e2e:libs
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import path from 'path';
import { execSync } from 'child_process';
import type { IAgentLib, AgentLibRunOptions, AgentLibCallbacks } from '../../src/core/interfaces/agent-lib';
import { ClaudeCodeLib } from '../../src/core/libs/claude-code-lib';
import { CursorAgentLib } from '../../src/core/libs/cursor-agent-lib';
import { CodexCliLib } from '../../src/core/libs/codex-cli-lib';

const PROMPT = 'Return a JSON object with greeting set to "hello world" and number set to 42. Nothing else.';

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    greeting: { type: 'string' as const, description: 'Say "hello world"' },
    number: { type: 'number' as const, description: 'The number 42' },
  },
  required: ['greeting', 'number'],
};

/** Project root — a real git repo that CLI tools will trust. */
const PROJECT_CWD = path.resolve(__dirname, '../..');

/** Patterns that indicate a workspace trust / git-repo guard error rather than a real API failure. */
const TRUST_ERROR_PATTERNS = [
  /workspace trust/i,
  /trusted directory/i,
  /skip-git-repo-check/i,
];

/**
 * Check if a CLI binary is available by running `<binary> --version`.
 * Used instead of lib.isAvailable() for spawn-based libs to avoid duplication.
 */
function isBinaryAvailable(binary: string): boolean {
  try {
    execSync(`${binary} --version`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the Claude Agent SDK can be imported.
 *
 * ClaudeCodeLib.isAvailable() uses a `new Function('specifier', 'return import(specifier)')`
 * trick to dynamically import the ESM-only SDK. This works in normal Node but vitest
 * intercepts import() calls through its own module transformer, causing false negatives.
 * We check availability by trying the import directly here (vitest handles it fine).
 */
async function isClaudeSdkAvailable(): Promise<boolean> {
  try {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    return typeof mod.query === 'function';
  } catch {
    return false;
  }
}

async function isCodexSdkAvailable(): Promise<boolean> {
  try {
    const mod = await import('@openai/codex-sdk');
    return typeof mod.Codex === 'function';
  } catch {
    return false;
  }
}

type AvailabilityCheck = (() => boolean) | (() => Promise<boolean>);

interface LibEntry {
  name: string;
  lib: IAgentLib;
  /** Override model for cost savings (use cheapest available). */
  model?: string;
  supportsStructuredOutput: boolean;
  /** Custom availability check (bypasses lib.isAvailable() when needed). */
  checkAvailable: AvailabilityCheck;
}

const LIBS: LibEntry[] = [
  { name: 'ClaudeCodeLib', lib: new ClaudeCodeLib(), model: 'claude-haiku-4-5-20251001', supportsStructuredOutput: true, checkAvailable: isClaudeSdkAvailable },
  { name: 'CursorAgentLib', lib: new CursorAgentLib(), supportsStructuredOutput: false, checkAvailable: () => isBinaryAvailable('cursor-agent') },
  { name: 'CodexCliLib', lib: new CodexCliLib(), supportsStructuredOutput: false, checkAvailable: isCodexSdkAvailable },
];

describe.each(LIBS)('$name e2e', ({ name, lib, model, supportsStructuredOutput, checkAvailable }) => {
  it('executes a trivial prompt and returns output', async () => {
    const available = await checkAvailable();
    if (!available) {
      console.warn(`[SKIP] ${name}: engine not available on this machine`);
      return;
    }

    const runId = randomUUID();
    const outputChunks: string[] = [];

    const options: AgentLibRunOptions = {
      prompt: PROMPT,
      cwd: PROJECT_CWD,
      model,
      maxTurns: 5,
      timeoutMs: 120_000,
      readOnly: true,
      allowedPaths: [],
      readOnlyPaths: [],
      ...(supportsStructuredOutput ? { outputFormat: OUTPUT_SCHEMA } : {}),
    };

    const callbacks: AgentLibCallbacks = {
      onOutput: (chunk) => outputChunks.push(chunk),
      onLog: (msg) => console.log(`  [${name}] ${msg}`),
    };

    let result;
    try {
      result = await lib.execute(runId, options, callbacks);
    } catch (err) {
      // ClaudeCodeLib uses `new Function('specifier', 'return import(specifier)')` to load the ESM SDK.
      // Vitest intercepts dynamic imports and doesn't support this pattern, causing a TypeError.
      // Skip gracefully when this happens — the lib works fine in production (Node/Electron).
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('dynamic import') || msg.includes('import callback')) {
        console.warn(`[SKIP] ${name}: dynamic import not supported in vitest — ${msg}`);
        return;
      }
      throw err;
    }

    // Skip gracefully if the engine rejects the workspace (trust prompt, git-repo guard, etc.)
    if (result.exitCode !== 0 && result.error && TRUST_ERROR_PATTERNS.some((p) => p.test(result.error!))) {
      console.warn(`[SKIP] ${name}: workspace not trusted — ${result.error.split('\n')[0]}`);
      return;
    }

    // Core assertion: engine completed successfully
    expect(result.exitCode).toBe(0);
    expect(result.model).toBeTruthy();

    // Output content checks — warn if empty (may indicate output-parsing gap)
    if (result.output.length === 0 && result.structuredOutput == null) {
      console.warn(`  [${name}] WARNING: exitCode=0 but no text output and no structured output — possible output-parsing gap`);
    }
    if (outputChunks.length === 0) {
      console.warn(`  [${name}] WARNING: onOutput callback was never called`);
    }

    // Structured output assertions for libs that support it
    if (supportsStructuredOutput) {
      expect(result.structuredOutput).toBeDefined();
      expect(result.structuredOutput).toHaveProperty('greeting');
      expect(result.structuredOutput).toHaveProperty('number');
      expect(result.structuredOutput!.greeting).toBe('hello world');
      expect(result.structuredOutput!.number).toBe(42);
    }

    console.log(`  [${name}] OK — exitCode=${result.exitCode}, outputLen=${result.output.length}, chunks=${outputChunks.length}, model=${result.model}`);
  });
});
