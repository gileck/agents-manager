import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgentFileConfig, AgentFileConfigJson, AgentMode, RevisionReason } from '../../shared/types';

type LogFn = (message: string, data?: Record<string, unknown>) => void;

/** Mode suffix mapping for prompt file resolution. */
const MODE_SUFFIX_MAP: Record<string, string> = {
  'changes_requested': 'revision',
  'merge_failed': 'merge',
  'info_provided': 'resume',
  'uncommitted_changes': 'uncommitted',
};

/**
 * Validate a single config field from config.json. Returns true if valid, false otherwise.
 */
function validateConfigField(key: string, value: unknown, log: LogFn, configPath: string): boolean {
  switch (key) {
    case 'engine':
    case 'model':
      if (typeof value !== 'string' || value.trim() === '') {
        log(`${configPath}: ${key}=${JSON.stringify(value)} is invalid (must be non-empty string), skipping`);
        return false;
      }
      return true;

    case 'maxTurns':
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        log(`${configPath}: maxTurns=${JSON.stringify(value)} is invalid (must be positive integer), skipping`);
        return false;
      }
      return true;

    case 'timeout':
      if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        log(`${configPath}: timeout=${JSON.stringify(value)} is invalid (must be positive integer), skipping`);
        return false;
      }
      return true;

    case 'readOnly':
      if (typeof value !== 'boolean') {
        log(`${configPath}: readOnly=${JSON.stringify(value)} is invalid (must be boolean), skipping`);
        return false;
      }
      return true;

    case 'disallowedTools':
      if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) {
        log(`${configPath}: disallowedTools=${JSON.stringify(value)} is invalid (must be string array), skipping`);
        return false;
      }
      return true;

    case 'outputFormat':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        log(`${configPath}: outputFormat=${JSON.stringify(value)} is invalid (must be non-null object), skipping`);
        return false;
      }
      return true;

    default:
      // Unknown field — skip silently (forward-compatible)
      return false;
  }
}

/**
 * Read a file from disk. Returns content on success, null on any error.
 * Logs at appropriate levels: missing file = debug, other errors = warn.
 */
function readFileSafe(filePath: string, log: LogFn): string | null {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // File not found is normal — debug level
      return null;
    }
    // Permission denied, I/O errors, etc. — warn level
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to read ${filePath}: ${message}`, { error: message, path: filePath });
    return null;
  }
}

/**
 * Load the prompt file for an agent, with mode-specific fallback chain:
 *   1. prompt.{modeSuffix}.md  (if mode=revision and revisionReason is set)
 *   2. prompt.md               (base prompt)
 *   3. null                    (no file-based prompt)
 */
function loadPrompt(
  agentDir: string,
  mode: AgentMode,
  revisionReason: RevisionReason | undefined,
  log: LogFn,
): { prompt: string; promptPath: string } | null {
  const candidates: string[] = [];

  // Mode-specific prompt file
  if (mode === 'revision' && revisionReason) {
    const suffix = MODE_SUFFIX_MAP[revisionReason];
    if (suffix) {
      candidates.push(join(agentDir, `prompt.${suffix}.md`));
    }
  }

  // Base prompt file
  candidates.push(join(agentDir, 'prompt.md'));

  for (const filePath of candidates) {
    const content = readFileSafe(filePath, log);
    if (content !== null) {
      const trimmed = content.trim();
      if (trimmed === '') {
        log(`File-based prompt at ${filePath} is empty, falling back to hardcoded default`, { path: filePath });
        continue;
      }
      return { prompt: trimmed, promptPath: filePath };
    }
  }

  return null;
}

/**
 * Load and validate config.json for an agent. Returns validated fields.
 * Invalid individual fields are skipped (not the entire config).
 */
function loadConfig(
  agentDir: string,
  log: LogFn,
): { config: AgentFileConfigJson; configPath: string } | null {
  const configPath = join(agentDir, 'config.json');
  const content = readFileSafe(configPath, log);
  if (content === null) return null;

  const trimmed = content.trim();
  if (trimmed === '') {
    log(`Config file at ${configPath} is empty, skipping`, { path: configPath });
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Failed to parse ${configPath}: ${message}`, { error: message, path: configPath });
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    log(`${configPath} must contain a JSON object, got ${typeof parsed}`, { path: configPath });
    return null;
  }

  const raw = parsed as Record<string, unknown>;
  const validConfig: AgentFileConfigJson = {};
  const KNOWN_FIELDS = ['engine', 'model', 'maxTurns', 'timeout', 'readOnly', 'disallowedTools', 'outputFormat'];

  for (const key of KNOWN_FIELDS) {
    if (key in raw) {
      if (validateConfigField(key, raw[key], log, configPath)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (validConfig as any)[key] = raw[key];
      }
    }
  }

  // Warn about unknown fields
  for (const key of Object.keys(raw)) {
    if (!KNOWN_FIELDS.includes(key)) {
      log(`${configPath}: unknown field "${key}" ignored`, { path: configPath, field: key });
    }
  }

  return { config: validConfig, configPath };
}

/**
 * Load file-based agent configuration from `{projectPath}/.agents/{agentType}/`.
 *
 * Never throws — always returns partial results. Errors are logged via `onLog`.
 *
 * Resolution chain (2-tier):
 *   File (.agents/{agentType}/) > Code (hardcoded builder defaults)
 */
export function loadAgentFileConfig(
  projectPath: string,
  agentType: string,
  mode: AgentMode,
  revisionReason: RevisionReason | undefined,
  onLog?: LogFn,
): AgentFileConfig {
  const log: LogFn = onLog ?? (() => {});
  const agentDir = join(projectPath, '.agents', agentType);
  const result: AgentFileConfig = {};

  // Load prompt
  const promptResult = loadPrompt(agentDir, mode, revisionReason, log);
  if (promptResult) {
    result.prompt = promptResult.prompt;
    result.promptPath = promptResult.promptPath;
    log(`Using file-based prompt from ${promptResult.promptPath}`, { agentType, path: promptResult.promptPath });
  }

  // Load config
  const configResult = loadConfig(agentDir, log);
  if (configResult) {
    result.config = configResult.config;
    result.configPath = configResult.configPath;
    log(`Loaded config from ${configResult.configPath}`, { agentType, path: configResult.configPath, fields: Object.keys(configResult.config) });
  }

  if (!promptResult && !configResult) {
    log(`No file-based config found for ${agentType}`, { agentType, dir: agentDir });
  }

  return result;
}
