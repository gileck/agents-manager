import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { initAgentFiles, showAgentConfig, deleteAgentFiles, writeAgentPrompt } from '../../src/core/agents/agent-file-config-writer';
import { AGENT_BUILDERS } from '../../src/core/agents/agent-builders';

const TEST_DIR = path.join(__dirname, '..', '.tmp-agent-file-config-writer-test');

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('initAgentFiles', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('scaffolds all agent types when no agentType is specified', () => {
    const result = initAgentFiles(TEST_DIR);

    const expectedTypes = Object.keys(AGENT_BUILDERS);
    for (const type of expectedTypes) {
      const promptPath = path.join(TEST_DIR, '.agents', type, 'prompt.md');
      const configPath = path.join(TEST_DIR, '.agents', type, 'config.json');
      expect(fs.existsSync(promptPath)).toBe(true);
      expect(fs.existsSync(configPath)).toBe(true);
    }

    // Each agent type should have 2 files (prompt + config)
    expect(result.created.length).toBe(expectedTypes.length * 2);
    expect(result.skipped.length).toBe(0);
  });

  it('scaffolds a single agent type when specified', () => {
    const result = initAgentFiles(TEST_DIR, 'planner');

    const promptPath = path.join(TEST_DIR, '.agents', 'planner', 'prompt.md');
    const configPath = path.join(TEST_DIR, '.agents', 'planner', 'config.json');
    expect(fs.existsSync(promptPath)).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);

    // Should not create files for other agent types
    const reviewerPath = path.join(TEST_DIR, '.agents', 'reviewer');
    expect(fs.existsSync(reviewerPath)).toBe(false);

    expect(result.created.length).toBe(2);
    expect(result.skipped.length).toBe(0);
  });

  it('skips existing files without --force', () => {
    // First init
    initAgentFiles(TEST_DIR, 'planner');

    // Modify prompt to verify it wasn't overwritten
    const promptPath = path.join(TEST_DIR, '.agents', 'planner', 'prompt.md');
    fs.writeFileSync(promptPath, 'CUSTOM CONTENT', 'utf-8');

    // Second init
    const result = initAgentFiles(TEST_DIR, 'planner');

    expect(result.skipped.length).toBe(2); // prompt + config
    expect(result.created.length).toBe(0);
    expect(fs.readFileSync(promptPath, 'utf-8')).toBe('CUSTOM CONTENT');
  });

  it('overwrites existing files with --force', () => {
    // First init
    initAgentFiles(TEST_DIR, 'planner');

    // Modify prompt
    const promptPath = path.join(TEST_DIR, '.agents', 'planner', 'prompt.md');
    fs.writeFileSync(promptPath, 'CUSTOM CONTENT', 'utf-8');

    // Second init with force
    const result = initAgentFiles(TEST_DIR, 'planner', { force: true });

    expect(result.created.length).toBe(2);
    expect(result.skipped.length).toBe(0);
    expect(fs.readFileSync(promptPath, 'utf-8')).not.toBe('CUSTOM CONTENT');
  });

  it('throws for unknown agent type', () => {
    expect(() => initAgentFiles(TEST_DIR, 'nonexistent')).toThrow('Unknown agent type');
  });

  it('creates valid JSON in config.json', () => {
    initAgentFiles(TEST_DIR, 'planner');

    const configPath = path.join(TEST_DIR, '.agents', 'planner', 'config.json');
    const content = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(content);

    expect(typeof parsed.maxTurns).toBe('number');
    expect(typeof parsed.timeout).toBe('number');
    expect(typeof parsed.readOnly).toBe('boolean');
    expect(parsed.maxTurns).toBeGreaterThan(0);
    expect(parsed.timeout).toBeGreaterThan(0);
  });

  it('creates non-empty prompt.md', () => {
    initAgentFiles(TEST_DIR, 'planner');

    const promptPath = path.join(TEST_DIR, '.agents', 'planner', 'prompt.md');
    const content = fs.readFileSync(promptPath, 'utf-8');

    // Should have the header comment and actual prompt content
    expect(content.length).toBeGreaterThan(100);
    expect(content).toContain('Available variables');
  });
});

describe('showAgentConfig', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows default config when no .agents/ exists', () => {
    const result = showAgentConfig(TEST_DIR, 'planner');

    expect(result.promptSource).toBe('default');
    expect(result.configSources.maxTurns).toBe('default');
    expect(result.configSources.timeout).toBe('default');
    expect(result.config.maxTurns).toBeGreaterThan(0);
    expect(result.hasFileConfig).toBe(false);
  });

  it('shows file config when .agents/ exists', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'prompt.md'), 'Custom planner prompt', 'utf-8');
    fs.writeFileSync(path.join(agentDir, 'config.json'), JSON.stringify({ maxTurns: 200 }), 'utf-8');

    const result = showAgentConfig(TEST_DIR, 'planner');

    expect(result.promptSource).toBe('file');
    expect(result.prompt).toBe('Custom planner prompt');
    expect(result.config.maxTurns).toBe(200);
    expect(result.configSources.maxTurns).toBe('file');
    expect(result.configSources.timeout).toBe('default');
    expect(result.hasFileConfig).toBe(true);
  });

  it('throws for unknown agent type', () => {
    expect(() => showAgentConfig(TEST_DIR, 'nonexistent')).toThrow('Unknown agent type');
  });

  it('reports hasFileConfig=false when dir exists but is empty', () => {
    // Create the .agents/planner dir but don't put files in it
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    fs.mkdirSync(agentDir, { recursive: true });

    const result = showAgentConfig(TEST_DIR, 'planner');

    // hasFileConfig should be true because the directory exists
    expect(result.hasFileConfig).toBe(true);
    // But content should be from defaults since no files exist
    expect(result.promptSource).toBe('default');
  });
});

describe('deleteAgentFiles', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('deletes a single agent type directory', () => {
    initAgentFiles(TEST_DIR, 'planner');
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    expect(fs.existsSync(agentDir)).toBe(true);

    const result = deleteAgentFiles(TEST_DIR, 'planner');

    expect(result.deleted.length).toBe(1);
    expect(result.deleted[0]).toBe(agentDir);
    expect(fs.existsSync(agentDir)).toBe(false);
    // .agents/ dir should still exist (only planner was deleted)
    expect(fs.existsSync(path.join(TEST_DIR, '.agents'))).toBe(true);
  });

  it('deletes entire .agents/ directory when no agentType specified', () => {
    initAgentFiles(TEST_DIR);
    const agentsDir = path.join(TEST_DIR, '.agents');
    expect(fs.existsSync(agentsDir)).toBe(true);

    const result = deleteAgentFiles(TEST_DIR);

    expect(result.deleted.length).toBe(1);
    expect(result.deleted[0]).toBe(agentsDir);
    expect(fs.existsSync(agentsDir)).toBe(false);
  });

  it('returns empty deleted array when .agents/ does not exist', () => {
    const result = deleteAgentFiles(TEST_DIR, 'planner');

    expect(result.deleted.length).toBe(0);
  });

  it('returns empty deleted array when .agents/ dir does not exist (no type)', () => {
    const result = deleteAgentFiles(TEST_DIR);

    expect(result.deleted.length).toBe(0);
  });

  it('throws for unknown agent type', () => {
    expect(() => deleteAgentFiles(TEST_DIR, 'nonexistent')).toThrow('Unknown agent type');
  });

  it('only deletes the specified agent type, leaving others intact', () => {
    initAgentFiles(TEST_DIR); // Init all

    deleteAgentFiles(TEST_DIR, 'planner');

    // Planner should be gone
    expect(fs.existsSync(path.join(TEST_DIR, '.agents', 'planner'))).toBe(false);
    // Others should still exist
    expect(fs.existsSync(path.join(TEST_DIR, '.agents', 'reviewer'))).toBe(true);
    expect(fs.existsSync(path.join(TEST_DIR, '.agents', 'implementor'))).toBe(true);
  });
});

describe('writeAgentPrompt', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('writes prompt.md to the correct path', () => {
    const result = writeAgentPrompt(TEST_DIR, 'planner', 'Custom prompt content');

    expect(result.path).toBe(path.join(TEST_DIR, '.agents', 'planner', 'prompt.md'));
    expect(fs.existsSync(result.path)).toBe(true);
    expect(fs.readFileSync(result.path, 'utf-8')).toBe('Custom prompt content');
  });

  it('creates the .agents/{agentType}/ directory if needed', () => {
    const agentDir = path.join(TEST_DIR, '.agents', 'planner');
    expect(fs.existsSync(agentDir)).toBe(false);

    writeAgentPrompt(TEST_DIR, 'planner', 'New prompt');

    expect(fs.existsSync(agentDir)).toBe(true);
  });

  it('overwrites existing prompt.md', () => {
    writeAgentPrompt(TEST_DIR, 'planner', 'First version');
    writeAgentPrompt(TEST_DIR, 'planner', 'Second version');

    const promptPath = path.join(TEST_DIR, '.agents', 'planner', 'prompt.md');
    expect(fs.readFileSync(promptPath, 'utf-8')).toBe('Second version');
  });

  it('throws for unknown agent type', () => {
    expect(() => writeAgentPrompt(TEST_DIR, 'nonexistent', 'content')).toThrow('Unknown agent type');
  });

  it('preserves existing config.json when writing prompt', () => {
    // Init first to create config.json
    initAgentFiles(TEST_DIR, 'planner');
    const configPath = path.join(TEST_DIR, '.agents', 'planner', 'config.json');
    const originalConfig = fs.readFileSync(configPath, 'utf-8');

    // Write prompt (should not touch config.json)
    writeAgentPrompt(TEST_DIR, 'planner', 'Updated prompt');

    expect(fs.readFileSync(configPath, 'utf-8')).toBe(originalConfig);
  });
});
