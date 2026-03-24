/**
 * Tests for the file-based agent config daemon routes.
 * Since supertest is not available, we test the underlying functions
 * that the routes call, verifying the daemon API contract.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { initAgentFiles, showAgentConfig, deleteAgentFiles, writeAgentPrompt } from '../../src/core/agents/agent-file-config-writer';
import { AGENT_BUILDERS } from '../../src/core/agents/agent-builders';

const TEST_DIR = path.join(__dirname, '..', '.tmp-agent-definitions-routes-test');

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
}

describe('agent-definitions file-config route handlers', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  // ---- GET /api/agent-definitions/:agentType/effective ----

  describe('GET effective config', () => {
    it('returns EffectiveAgentConfig shape with defaults', () => {
      const result = showAgentConfig(TEST_DIR, 'planner');

      // Verify the shape matches what the route returns
      expect(result).toHaveProperty('prompt');
      expect(result).toHaveProperty('promptSource');
      expect(result).toHaveProperty('config');
      expect(result).toHaveProperty('configSources');
      expect(result).toHaveProperty('hasFileConfig');
      expect(result.promptSource).toBe('default');
      expect(result.hasFileConfig).toBe(false);
    });

    it('returns file source when .agents/ is configured', () => {
      const agentDir = path.join(TEST_DIR, '.agents', 'reviewer');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, 'prompt.md'), 'Custom reviewer prompt', 'utf-8');
      fs.writeFileSync(path.join(agentDir, 'config.json'), JSON.stringify({ timeout: 300000 }), 'utf-8');

      const result = showAgentConfig(TEST_DIR, 'reviewer');

      expect(result.promptSource).toBe('file');
      expect(result.prompt).toBe('Custom reviewer prompt');
      expect(result.config.timeout).toBe(300000);
      expect(result.configSources.timeout).toBe('file');
      expect(result.hasFileConfig).toBe(true);
    });

    it('returns effective config for all known agent types', () => {
      const types = Object.keys(AGENT_BUILDERS);
      for (const type of types) {
        const result = showAgentConfig(TEST_DIR, type);
        expect(result.promptSource).toBe('default');
        expect(typeof result.prompt).toBe('string');
        expect(result.prompt.length).toBeGreaterThan(0);
      }
    });
  });

  // ---- POST /api/agent-definitions/:agentType/init ----

  describe('POST init files', () => {
    it('initializes a single agent type', () => {
      const result = initAgentFiles(TEST_DIR, 'implementor');

      expect(result.created.length).toBe(2); // prompt + config
      expect(fs.existsSync(path.join(TEST_DIR, '.agents', 'implementor', 'prompt.md'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_DIR, '.agents', 'implementor', 'config.json'))).toBe(true);
    });

    it('initializes all agent types when no type specified (like agentType=all)', () => {
      const result = initAgentFiles(TEST_DIR);

      const expectedTypes = Object.keys(AGENT_BUILDERS);
      expect(result.created.length).toBe(expectedTypes.length * 2);
    });

    it('respects force flag', () => {
      initAgentFiles(TEST_DIR, 'planner');
      const promptPath = path.join(TEST_DIR, '.agents', 'planner', 'prompt.md');
      fs.writeFileSync(promptPath, 'CUSTOM', 'utf-8');

      // Without force — skips
      const result1 = initAgentFiles(TEST_DIR, 'planner');
      expect(result1.skipped.length).toBe(2);
      expect(fs.readFileSync(promptPath, 'utf-8')).toBe('CUSTOM');

      // With force — overwrites
      const result2 = initAgentFiles(TEST_DIR, 'planner', { force: true });
      expect(result2.created.length).toBe(2);
      expect(fs.readFileSync(promptPath, 'utf-8')).not.toBe('CUSTOM');
    });
  });

  // ---- DELETE /api/agent-definitions/:agentType/file-config ----

  describe('DELETE file-config', () => {
    it('deletes agent config directory', () => {
      initAgentFiles(TEST_DIR, 'designer');

      const result = deleteAgentFiles(TEST_DIR, 'designer');

      expect(result.deleted.length).toBe(1);
      expect(fs.existsSync(path.join(TEST_DIR, '.agents', 'designer'))).toBe(false);
    });

    it('deletes all config when no type specified (like agentType=all)', () => {
      initAgentFiles(TEST_DIR);

      const result = deleteAgentFiles(TEST_DIR);

      expect(result.deleted.length).toBe(1);
      expect(fs.existsSync(path.join(TEST_DIR, '.agents'))).toBe(false);
    });

    it('returns empty deleted when nothing to delete', () => {
      const result = deleteAgentFiles(TEST_DIR, 'planner');
      expect(result.deleted.length).toBe(0);
    });
  });

  // ---- GET /api/agent-definitions/types/list ----

  describe('GET types list', () => {
    it('returns all agent types from AGENT_BUILDERS', () => {
      const types = Object.keys(AGENT_BUILDERS);
      expect(types.length).toBeGreaterThan(0);
      expect(types).toContain('planner');
      expect(types).toContain('reviewer');
      expect(types).toContain('implementor');
    });
  });

  // ---- PUT /api/agent-definitions/:agentType/prompt ----

  describe('PUT update prompt', () => {
    it('writes prompt content to the correct file', () => {
      const result = writeAgentPrompt(TEST_DIR, 'planner', 'Updated planner prompt');

      expect(result.path).toContain('.agents/planner/prompt.md');
      expect(fs.readFileSync(result.path, 'utf-8')).toBe('Updated planner prompt');
    });

    it('creates directory and file when .agents/ does not exist', () => {
      expect(fs.existsSync(path.join(TEST_DIR, '.agents'))).toBe(false);

      writeAgentPrompt(TEST_DIR, 'reviewer', 'New reviewer prompt');

      expect(fs.existsSync(path.join(TEST_DIR, '.agents', 'reviewer', 'prompt.md'))).toBe(true);
    });

    it('overwrites existing prompt and shows file source in effective config', () => {
      initAgentFiles(TEST_DIR, 'planner');
      writeAgentPrompt(TEST_DIR, 'planner', 'Custom override prompt');

      const effective = showAgentConfig(TEST_DIR, 'planner');
      expect(effective.promptSource).toBe('file');
      expect(effective.prompt).toBe('Custom override prompt');
    });

    it('throws for unknown agent type', () => {
      expect(() => writeAgentPrompt(TEST_DIR, 'nonexistent', 'content')).toThrow('Unknown agent type');
    });
  });

  // ---- Round-trip: init → effective → delete → effective ----

  describe('round-trip lifecycle', () => {
    it('init → shows file source → delete → shows default source', () => {
      // 1. Before init — defaults
      let result = showAgentConfig(TEST_DIR, 'planner');
      expect(result.promptSource).toBe('default');
      expect(result.hasFileConfig).toBe(false);

      // 2. Init — creates files
      initAgentFiles(TEST_DIR, 'planner');

      // 3. After init — file source
      result = showAgentConfig(TEST_DIR, 'planner');
      expect(result.promptSource).toBe('file');
      expect(result.hasFileConfig).toBe(true);

      // 4. Delete — removes files
      deleteAgentFiles(TEST_DIR, 'planner');

      // 5. After delete — back to defaults
      result = showAgentConfig(TEST_DIR, 'planner');
      expect(result.promptSource).toBe('default');
      expect(result.hasFileConfig).toBe(false);
    });

    it('init → update prompt → effective shows custom → delete → defaults', () => {
      // 1. Init
      initAgentFiles(TEST_DIR, 'implementor');

      // 2. Update prompt
      writeAgentPrompt(TEST_DIR, 'implementor', 'Custom implementor instructions');

      // 3. Verify effective config shows the custom prompt
      let result = showAgentConfig(TEST_DIR, 'implementor');
      expect(result.promptSource).toBe('file');
      expect(result.prompt).toBe('Custom implementor instructions');
      expect(result.hasFileConfig).toBe(true);

      // 4. Delete
      deleteAgentFiles(TEST_DIR, 'implementor');

      // 5. Back to defaults
      result = showAgentConfig(TEST_DIR, 'implementor');
      expect(result.promptSource).toBe('default');
      expect(result.hasFileConfig).toBe(false);
    });
  });
});
