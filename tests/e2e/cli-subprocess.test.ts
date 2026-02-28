import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'bootstrap-cli.js');

/**
 * Spawns `node bootstrap-cli.js` with a temporary database
 * and returns { stdout, stderr, exitCode }.
 */
function runCli(args: string[], dbPath: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath, // node binary
      [CLI, '--db', dbPath, ...args],
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
  let tmpDir: string;
  let dbPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cli-e2e-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should start without crashing (status command)', async () => {
    const result = await runCli(['status'], dbPath);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Projects:');
    expect(result.stdout).toContain('Tasks:');
  });

  it('should show help', async () => {
    const result = await runCli(['--help'], dbPath);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Agents Manager CLI');
  });

  it('should list projects (empty on fresh db)', async () => {
    const result = await runCli(['projects', 'list'], dbPath);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No results');
  });

  it('should list pipelines (seeded)', async () => {
    const result = await runCli(['pipelines', 'list'], dbPath);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('NAME');
  });

  it('should create and list a project', async () => {
    const create = await runCli(
      ['projects', 'create', '--name', 'CLI-Test-Project', '--path', '/tmp/cli-e2e'],
      dbPath,
    );
    expect(create.exitCode).toBe(0);
    expect(create.stdout).toContain('CLI-Test-Project');

    const list = await runCli(['projects', 'list'], dbPath);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain('CLI-Test-Project');
  });

  it('should output JSON with --json flag', async () => {
    const result = await runCli(['--json', 'projects', 'list'], dbPath);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('should fail gracefully for unknown commands', async () => {
    const result = await runCli(['nonexistent-command'], dbPath);
    expect(result.exitCode).not.toBe(0);
  });
});

describe('CLI Electron isolation', () => {
  // Regression guard: The CLI import chain loads src/cli/ and most of src/main/
  // (via createAppServices in setup.ts). Static imports of Electron-only modules
  // in these files crash at module load time because Electron globals are undefined.
  //
  // Files NOT in the CLI import chain (safe to have Electron imports):
  //   - src/main/index.ts (Electron entry point)
  //   - src/main/ipc-handlers/ (registered only by Electron main process)
  //   - src/main/services/desktop-notification-router.ts (loaded via try-catch require)
  //
  // If you need Electron functionality in shared files, use a lazy require() inside
  // a try-catch (see trySendToRenderer in agent-handler.ts for the pattern).

  const FORBIDDEN_IMPORT_PATTERNS = [
    /^import\s+.*from\s+['"]@template\/main\/core\/window['"]/,
    /^import\s+.*from\s+['"]electron['"]/,
  ];

  // Directories/files loaded by the CLI via setup.ts
  const CLI_LOADED_DIRS = [
    path.join(ROOT, 'src', 'cli'),
    path.join(ROOT, 'src', 'main', 'agents'),
    path.join(ROOT, 'src', 'main', 'data'),
    path.join(ROOT, 'src', 'main', 'handlers'),
    path.join(ROOT, 'src', 'main', 'interfaces'),
    path.join(ROOT, 'src', 'main', 'libs'),
    path.join(ROOT, 'src', 'main', 'stores'),
    path.join(ROOT, 'src', 'main', 'providers'),
  ];

  // Individual files loaded by CLI (services loaded by setup.ts, excluding
  // desktop-notification-router.ts which is loaded via try-catch require)
  const CLI_LOADED_SERVICE_DIR = path.join(ROOT, 'src', 'main', 'services');
  const ELECTRON_ONLY_FILES = new Set([
    'desktop-notification-router.ts',
  ]);

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

  function getCliLoadedFiles(): string[] {
    const files: string[] = [];

    for (const dir of CLI_LOADED_DIRS) {
      files.push(...findTsFiles(dir));
    }

    // Add services dir, excluding Electron-only files
    if (fs.existsSync(CLI_LOADED_SERVICE_DIR)) {
      for (const f of findTsFiles(CLI_LOADED_SERVICE_DIR)) {
        if (!ELECTRON_ONLY_FILES.has(path.basename(f))) {
          files.push(f);
        }
      }
    }

    // Add setup.ts and migrations.ts directly
    const directFiles = [
      path.join(ROOT, 'src', 'main', 'migrations.ts'),
    ];
    for (const f of directFiles) {
      if (fs.existsSync(f)) files.push(f);
    }

    return files;
  }

  it('should not have static Electron imports in CLI-loaded source files', () => {
    const violations: string[] = [];

    for (const filePath of getCliLoadedFiles()) {
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
      'Static Electron imports found in CLI-loaded files. Use lazy require() inside try-catch instead.\n' +
      violations.join('\n'),
    ).toEqual([]);
  });
});
