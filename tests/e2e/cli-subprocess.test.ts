import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'bootstrap-cli.js');

/**
 * Spawns `node bootstrap-cli.js` and returns { stdout, stderr, exitCode }.
 * Note: The CLI now requires a running daemon. Tests that need CRUD
 * operations are skipped unless a daemon is available.
 */
function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath, // node binary
      [CLI, ...args],
      { cwd: ROOT, timeout: 30_000 },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          exitCode: error?.code ? (typeof error.code === 'number' ? error.code : 1) : 0,
        });
      },
    );
  });
}

describe('CLI subprocess e2e', () => {
  it('should show help', async () => {
    const result = await runCli(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Agents Manager CLI');
  });

  it('should show daemon help', async () => {
    const result = await runCli(['daemon', '--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('daemon');
  });

  it('should fail gracefully for unknown commands', async () => {
    const result = await runCli(['nonexistent-command']);
    expect(result.exitCode).not.toBe(0);
  });
});

describe('CLI Electron isolation', () => {
  // Regression guard: The CLI should only import from src/client/ and src/shared/,
  // never from src/core/ or Electron modules. The daemon owns all core services.

  const FORBIDDEN_IMPORT_PATTERNS = [
    /^import\s+.*from\s+['"].*\/core\//,
    /^import\s+.*from\s+['"]@template\//,
    /^import\s+.*from\s+['"]electron['"]/,
  ];

  // CLI source directories (excluding daemon.ts which references the built binary path)
  const CLI_DIR = path.join(ROOT, 'src', 'cli');

  function findTsFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findTsFiles(full));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        results.push(full);
      }
    }
    return results;
  }

  it('should not have core/Electron imports in CLI source files', () => {
    const violations: string[] = [];

    for (const filePath of findTsFiles(CLI_DIR)) {
      // daemon.ts is allowed to reference paths without importing core
      if (path.basename(filePath) === 'daemon.ts') continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
          if (pattern.test(line)) {
            const relative = path.relative(ROOT, filePath);
            violations.push(`${relative}:${i + 1}: ${line}`);
          }
        }
      }
    }

    expect(
      violations,
      'Forbidden imports found in CLI files. CLI should only import from src/client/ and src/shared/.\n' +
      violations.join('\n'),
    ).toEqual([]);
  });
});
