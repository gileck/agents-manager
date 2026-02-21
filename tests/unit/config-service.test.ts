import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import { loadGlobalConfig, loadProjectConfig, getResolvedConfig } from '../../src/main/services/config-service';

vi.mock('fs');
vi.mock('os');

const mockedFs = vi.mocked(fs);
const mockedOs = vi.mocked(os);

describe('config-service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedOs.homedir.mockReturnValue('/home/testuser');
  });

  describe('loadGlobalConfig', () => {
    it('returns parsed JSON when file exists', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('{"agentTimeout": 60000, "maxConcurrentAgents": 5}');

      const result = loadGlobalConfig();

      expect(result).toEqual({ agentTimeout: 60000, maxConcurrentAgents: 5 });
      expect(mockedFs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining('.agents-manager/config.json')
      );
    });

    it('returns empty object when file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = loadGlobalConfig();

      expect(result).toEqual({});
    });

    it('returns empty object when file contains invalid JSON', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('not valid json {{{');

      const result = loadGlobalConfig();

      expect(result).toEqual({});
    });
  });

  describe('loadProjectConfig', () => {
    it('returns parsed JSON when file exists', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('{"defaultPipeline": "custom"}');

      const result = loadProjectConfig('/my/project');

      expect(result).toEqual({ defaultPipeline: 'custom' });
      expect(mockedFs.existsSync).toHaveBeenCalledWith(
        '/my/project/.agents-manager/config.json'
      );
    });

    it('returns empty object when file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = loadProjectConfig('/my/project');

      expect(result).toEqual({});
    });

    it('returns empty object when file contains invalid JSON', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('}{broken');

      const result = loadProjectConfig('/some/path');

      expect(result).toEqual({});
    });
  });

  describe('getResolvedConfig', () => {
    it('returns defaults when no global or project configs exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = getResolvedConfig();

      expect(result.defaultPipeline).toBe('simple');
      expect(result.agentTimeout).toBe(300000);
      expect(result.maxConcurrentAgents).toBe(3);
    });

    it('global config overrides defaults', () => {
      // First call is for global config, second would be for project
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('{"agentTimeout": 60000}');

      const result = getResolvedConfig();

      expect(result.agentTimeout).toBe(60000);
      // Other defaults preserved
      expect(result.defaultPipeline).toBe('simple');
      expect(result.maxConcurrentAgents).toBe(3);
    });

    it('project config overrides global config', () => {
      mockedFs.existsSync.mockReturnValue(true);
      // First call: global config
      mockedFs.readFileSync
        .mockReturnValueOnce('{"agentTimeout": 60000, "maxConcurrentAgents": 10}')
        // Second call: project config
        .mockReturnValueOnce('{"agentTimeout": 30000}');

      const result = getResolvedConfig('/my/project');

      expect(result.agentTimeout).toBe(30000); // project wins
      expect(result.maxConcurrentAgents).toBe(10); // global wins over default
    });

    it('merges telegram config from both global and project', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync
        .mockReturnValueOnce('{"telegram": {"botToken": "global-token"}}')
        .mockReturnValueOnce('{"telegram": {"chatId": "project-chat"}}');

      const result = getResolvedConfig('/my/project');

      expect(result.telegram).toEqual({
        botToken: 'global-token',
        chatId: 'project-chat',
      });
    });

    it('project telegram overrides global telegram fields', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync
        .mockReturnValueOnce('{"telegram": {"botToken": "global-token", "chatId": "global-chat"}}')
        .mockReturnValueOnce('{"telegram": {"chatId": "project-chat"}}');

      const result = getResolvedConfig('/my/project');

      expect(result.telegram).toEqual({
        botToken: 'global-token',
        chatId: 'project-chat', // project overrides global
      });
    });

    it('applies defaults when global config is empty JSON object', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('{}');

      const result = getResolvedConfig();

      expect(result.defaultPipeline).toBe('simple');
      expect(result.agentTimeout).toBe(300000);
      expect(result.maxConcurrentAgents).toBe(3);
    });

    it('does not load project config when projectPath is not provided', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const result = getResolvedConfig();

      // Should only have been called once (for global config path)
      expect(mockedFs.existsSync).toHaveBeenCalledTimes(1);
      expect(result.defaultPipeline).toBe('simple');
    });
  });
});
