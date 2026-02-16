import { execSync } from 'child_process';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

let cachedPath: string | null = null;

/**
 * Resolve the user's full shell PATH.
 * Electron GUI apps launch with minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
 * This runs the user's login shell to get the real PATH so we can find
 * claude, node, git, etc.
 */
export function getUserShellPath(): string {
  if (cachedPath) return cachedPath;

  const systemOnly = /^\/usr\/bin:\/bin(:\/usr\/sbin:\/sbin)?$/;

  // Try login shell approaches
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

      if (result && !systemOnly.test(result)) {
        cachedPath = result;
        return cachedPath;
      }
    } catch {
      // Try next shell
    }
  }

  // Fallback: scan known locations and build a PATH
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

  // Other common locations
  for (const dir of [
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.cargo', 'bin'),
  ]) {
    if (existsSync(dir)) extraDirs.push(dir);
  }

  const basePath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
  cachedPath = extraDirs.length > 0
    ? [...extraDirs, basePath].join(':')
    : basePath;

  return cachedPath;
}

export function getShellEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: getUserShellPath(), HOME: homedir() };
}
