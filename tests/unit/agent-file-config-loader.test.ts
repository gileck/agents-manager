import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { loadAgentFileConfig } from '../../src/core/agents/agent-file-config-loader';

// Create a real temp directory for tests
const TEST_DIR = path.join(__dirname, '..', '.tmp-agent-file-config-test');

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(filePath: string, content: string) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
}

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('loadAgentFileConfig', () => {
  let logs: string[];
  const log = (msg: string) => { logs.push(msg); };

  beforeEach(() => {
    cleanup();
    logs = [];
    ensureDir(TEST_DIR);
  });

  afterEach(() => {
    cleanup();
  });

  // ----- Prompt loading -----

  it('loads prompt.md when present', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'prompt.md'), 'You are a planner agent.\n{taskTitle}');

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.prompt).toBe('You are a planner agent.\n{taskTitle}');
    expect(result.promptPath).toContain('prompt.md');
    expect(logs.some(l => l.includes('Using file-based prompt'))).toBe(true);
  });

  it('returns no prompt when prompt.md does not exist', () => {
    ensureDir(path.join(TEST_DIR, '.agents', 'planner'));

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.prompt).toBeUndefined();
    expect(result.promptPath).toBeUndefined();
    expect(logs.some(l => l.includes('No file-based config found'))).toBe(true);
  });

  it('falls back to prompt.md when mode-specific file is missing', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'prompt.md'), 'Base prompt content');

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'revision', 'changes_requested', log);

    expect(result.prompt).toBe('Base prompt content');
    expect(result.promptPath).toContain('prompt.md');
  });

  it('prefers prompt.revision.md for changes_requested mode', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'prompt.md'), 'Base prompt');
    writeFile(path.join(agentDir, 'prompt.revision.md'), 'Revision prompt');

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'revision', 'changes_requested', log);

    expect(result.prompt).toBe('Revision prompt');
    expect(result.promptPath).toContain('prompt.revision.md');
  });

  it('prefers prompt.merge.md for merge_failed mode', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'implementor');
    writeFile(path.join(agentDir, 'prompt.md'), 'Base prompt');
    writeFile(path.join(agentDir, 'prompt.merge.md'), 'Merge prompt');

    const result = loadAgentFileConfig(TEST_DIR, 'implementor', 'revision', 'merge_failed', log);

    expect(result.prompt).toBe('Merge prompt');
    expect(result.promptPath).toContain('prompt.merge.md');
  });

  it('prefers prompt.resume.md for info_provided mode', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'prompt.md'), 'Base prompt');
    writeFile(path.join(agentDir, 'prompt.resume.md'), 'Resume prompt');

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'revision', 'info_provided', log);

    expect(result.prompt).toBe('Resume prompt');
    expect(result.promptPath).toContain('prompt.resume.md');
  });

  it('skips empty prompt.md and logs warning', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'prompt.md'), '   \n  ');

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.prompt).toBeUndefined();
    expect(logs.some(l => l.includes('empty'))).toBe(true);
  });

  it('returns no prompt when .agents directory does not exist', () => {
    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.prompt).toBeUndefined();
    expect(logs.some(l => l.includes('No file-based config found'))).toBe(true);
  });

  // ----- Config loading -----

  it('loads valid config.json', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), JSON.stringify({
      maxTurns: 50,
      timeout: 300000,
      readOnly: true,
    }));

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config).toEqual({
      maxTurns: 50,
      timeout: 300000,
      readOnly: true,
    });
    expect(result.configPath).toContain('config.json');
  });

  it('validates each config field independently — skips invalid, keeps valid', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), JSON.stringify({
      maxTurns: -5,
      timeout: 300000,
      readOnly: 'yes',
    }));

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config).toEqual({ timeout: 300000 });
    expect(logs.some(l => l.includes('maxTurns') && l.includes('invalid'))).toBe(true);
    expect(logs.some(l => l.includes('readOnly') && l.includes('invalid'))).toBe(true);
  });

  it('handles invalid JSON in config.json', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), '{ not valid json }}}');

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config).toBeUndefined();
    expect(logs.some(l => l.includes('Failed to parse'))).toBe(true);
  });

  it('handles empty config.json', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), '');

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config).toBeUndefined();
    expect(logs.some(l => l.includes('empty'))).toBe(true);
  });

  it('validates engine and model as non-empty strings', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), JSON.stringify({
      engine: '',
      model: 'claude-sonnet-4-5-20250929',
    }));

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config).toEqual({ model: 'claude-sonnet-4-5-20250929' });
    expect(logs.some(l => l.includes('engine') && l.includes('invalid'))).toBe(true);
  });

  it('validates disallowedTools as string array', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), JSON.stringify({
      disallowedTools: ['Edit', 'MultiEdit'],
    }));

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config?.disallowedTools).toEqual(['Edit', 'MultiEdit']);
  });

  it('validates outputFormat as non-null object', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), JSON.stringify({
      outputFormat: { type: 'json_schema', schema: {} },
    }));

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config?.outputFormat).toEqual({ type: 'json_schema', schema: {} });
  });

  it('rejects outputFormat that is null or array', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), JSON.stringify({
      outputFormat: [1, 2, 3],
    }));

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config?.outputFormat).toBeUndefined();
    expect(logs.some(l => l.includes('outputFormat') && l.includes('invalid'))).toBe(true);
  });

  it('warns about unknown fields in config.json', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), JSON.stringify({
      maxTurns: 50,
      unknownField: true,
    }));

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config?.maxTurns).toBe(50);
    expect(logs.some(l => l.includes('unknownField') && l.includes('ignored'))).toBe(true);
  });

  it('rejects non-object config.json (e.g., array)', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), '[1, 2, 3]');

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config).toBeUndefined();
    expect(logs.some(l => l.includes('must contain a JSON object'))).toBe(true);
  });

  // ----- Combined prompt + config -----

  it('loads both prompt and config when both present', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'reviewer');
    writeFile(path.join(agentDir, 'prompt.md'), 'Review the code');
    writeFile(path.join(agentDir, 'config.json'), JSON.stringify({ readOnly: true, maxTurns: 200 }));

    const result = loadAgentFileConfig(TEST_DIR, 'reviewer', 'new', undefined, log);

    expect(result.prompt).toBe('Review the code');
    expect(result.config).toEqual({ readOnly: true, maxTurns: 200 });
  });

  // ----- Graceful fallback -----

  it('never throws — returns empty config on errors', () => {
    // Point to a path that doesn't exist at all
    const result = loadAgentFileConfig('/nonexistent/path', 'planner', 'new', undefined, log);

    expect(result).toBeDefined();
    expect(result.prompt).toBeUndefined();
    expect(result.config).toBeUndefined();
  });

  it('works without onLog callback', () => {
    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined);

    expect(result).toBeDefined();
  });

  // ----- maxTurns edge cases -----

  it('rejects non-integer maxTurns', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), JSON.stringify({ maxTurns: 5.5 }));

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config?.maxTurns).toBeUndefined();
    expect(logs.some(l => l.includes('maxTurns') && l.includes('invalid'))).toBe(true);
  });

  it('rejects zero maxTurns', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    writeFile(path.join(agentDir, 'config.json'), JSON.stringify({ maxTurns: 0 }));

    const result = loadAgentFileConfig(TEST_DIR, 'planner', 'new', undefined, log);

    expect(result.config?.maxTurns).toBeUndefined();
  });
});
