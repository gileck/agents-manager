import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AppConfig {
  defaultPipeline?: string;
  agentTimeout?: number;
  maxConcurrentAgents?: number;
  telegram?: { botToken?: string; chatId?: string };
  [key: string]: unknown;
}

const DEFAULT_CONFIG: AppConfig = {
  defaultPipeline: 'simple',
  agentTimeout: 300000,
  maxConcurrentAgents: 3,
};

const CONFIG_DIR_NAME = '.agents-manager';
const CONFIG_FILE_NAME = 'config.json';

function readJsonFile(filePath: string): Record<string, unknown> {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore parse errors, return empty
  }
  return {};
}

export function loadGlobalConfig(): Record<string, unknown> {
  const globalPath = path.join(os.homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);
  return readJsonFile(globalPath);
}

export function loadProjectConfig(projectPath: string): Record<string, unknown> {
  const projectConfigPath = path.join(projectPath, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
  return readJsonFile(projectConfigPath);
}

export function getResolvedConfig(projectPath?: string): AppConfig {
  const global = loadGlobalConfig();
  const project = projectPath ? loadProjectConfig(projectPath) : {};
  return { ...DEFAULT_CONFIG, ...global, ...project };
}
