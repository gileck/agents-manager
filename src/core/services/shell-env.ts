import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

const execFileAsync = promisify(execFile);

let cachedPath: string | null = null;

const SYSTEM_ONLY = /^\/usr\/bin:\/bin(:\/usr\/sbin:\/sbin)?$/;

/**
 * Eagerly initialize the shell PATH cache using async exec.
 * Call this at app startup (e.g. in onReady) so that subsequent
 * synchronous getUserShellPath() calls are instant cache hits.
 */
export async function initShellEnv(): Promise<void> {
  if (cachedPath) return;

  const shells = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
  ].filter(Boolean) as string[];

  for (const shell of shells) {
    try {
      const flags = shell.includes('zsh') ? '-li' : '-l';
      const { stdout } = await execFileAsync(shell, [flags, '-c', 'echo $PATH'], {
        timeout: 5000,
        env: { ...process.env, HOME: homedir() },
      });
      const result = stdout.trim();

      if (result && !SYSTEM_ONLY.test(result)) {
        cachedPath = result;
        return;
      }
    } catch {
      // Try next shell
    }
  }

  // Fallback: scan known locations and build a PATH
  cachedPath = buildFallbackPath();
}

/**
 * Resolve the user's full shell PATH.
 * Electron GUI apps launch with minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
 * This runs the user's login shell to get the real PATH so we can find
 * claude, node, git, etc.
 *
 * If initShellEnv() was called at startup, this is an instant cache hit.
 * Falls back to synchronous exec if cache is cold.
 */
export function getUserShellPath(): string {
  if (cachedPath) return cachedPath;

  // Synchronous fallback for cold cache (CLI usage or missed init)
  const shells = [
    process.env.SHELL,
    '/bin/zsh',
    '/bin/bash',
  ].filter(Boolean) as string[];

  for (const shell of shells) {
    try {
      const flags = shell.includes('zsh') ? '-li' : '-l';
      const result = execSync(`${shell} ${flags} -c "echo \\$PATH"`, {
        timeout: 5000,
        encoding: 'utf-8',
        env: { ...process.env, HOME: homedir() },
      }).trim();

      if (result && !SYSTEM_ONLY.test(result)) {
        cachedPath = result;
        return cachedPath;
      }
    } catch {
      // Try next shell
    }
  }

  cachedPath = buildFallbackPath();
  return cachedPath;
}

/**
 * Scan known tool-manager directories and build a fallback PATH.
 */
function buildFallbackPath(): string {
  const extraDirs: string[] = [];
  const home = homedir();

  // Homebrew
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
    if (existsSync(dir)) extraDirs.push(dir);
  }

  // nvm
  const nvmDir = join(home, '.nvm', 'versions', 'node');
  if (existsSync(nvmDir)) {
    try {
      const versions = readdirSync(nvmDir).sort().reverse();
      if (versions.length > 0) {
        extraDirs.push(join(nvmDir, versions[0], 'bin'));
      }
    } catch { /* ignore */ }
  }

  // fnm
  const fnmDir = join(home, '.local', 'share', 'fnm', 'node-versions');
  if (existsSync(fnmDir)) {
    try {
      const versions = readdirSync(fnmDir).sort().reverse();
      if (versions.length > 0) {
        extraDirs.push(join(fnmDir, versions[0], 'installation', 'bin'));
      }
    } catch { /* ignore */ }
  }

  // asdf
  const asdfDir = join(home, '.asdf', 'installs', 'nodejs');
  if (existsSync(asdfDir)) {
    try {
      const versions = readdirSync(asdfDir).sort().reverse();
      if (versions.length > 0) {
        extraDirs.push(join(asdfDir, versions[0], 'bin'));
      }
    } catch { /* ignore */ }
  }

  // Other common locations
  for (const dir of [
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.cargo', 'bin'),
  ]) {
    if (existsSync(dir)) extraDirs.push(dir);
  }

  const basePath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
  return extraDirs.length > 0
    ? [...extraDirs, basePath].join(':')
    : basePath;
}

export function getShellEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: getUserShellPath(), HOME: homedir() };
}
