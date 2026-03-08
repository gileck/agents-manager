/**
 * Ensures the daemon is running before the Electron app's IPC handlers
 * connect to it. If the daemon is not responding, it spawns the daemon
 * binary as a detached background process and waits for the health check.
 */

import { spawn, execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';
import { getUserShellPath } from '../shared/shell-env';

const DAEMON_DIR = path.join(os.homedir(), '.agents-manager');

function getDaemonPort(): number {
  const envPort = process.env.AM_DAEMON_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 3847;
}

function findProjectRoot(): string {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function getDaemonBinaryPath(): string {
  // dist-daemon/index.js at the project root.
  // __dirname varies between source (src/main/ — 2 levels) and built
  // (dist-main/src/main/ — 3 levels), so we find root via package.json.
  return path.join(findProjectRoot(), 'dist-daemon', 'index.js');
}

function findSystemNode(): string {
  // In Electron, process.execPath is the Electron binary, not node.
  // Resolve the system node binary from the user's shell PATH.
  const shellPath = getUserShellPath();
  for (const dir of shellPath.split(':')) {
    const candidate = path.join(dir, 'node');
    if (fs.existsSync(candidate)) return candidate;
  }
  // Last resort: try `which node` with the shell PATH
  try {
    return execFileSync('/usr/bin/which', ['node'], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: shellPath },
      timeout: 3000,
    }).trim();
  } catch {
    // Fall back to process.execPath (may work in non-Electron contexts)
    return process.execPath;
  }
}

function ensureDaemonDir(): void {
  if (!fs.existsSync(DAEMON_DIR)) {
    fs.mkdirSync(DAEMON_DIR, { recursive: true });
  }
}

function writePidFile(pid: number): void {
  ensureDaemonDir();
  fs.writeFileSync(path.join(DAEMON_DIR, 'daemon.pid'), String(pid), 'utf-8');
}

function openLogFile(): number {
  ensureDaemonDir();
  const logPath = path.join(DAEMON_DIR, 'daemon.log');
  return fs.openSync(logPath, 'a');
}

function httpHealthCheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: 3000 },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode === 200));
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function waitForHealth(port: number, maxAttempts = 20, intervalMs = 500): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await httpHealthCheck(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

export async function ensureDaemon(): Promise<{ url: string; wsUrl: string }> {
  const port = getDaemonPort();
  const url = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;

  // Check if already running
  if (await httpHealthCheck(port)) {
    return { url, wsUrl };
  }

  // Spawn daemon
  const daemonBin = getDaemonBinaryPath();
  if (!fs.existsSync(daemonBin)) {
    throw new Error(
      `Daemon binary not found at ${daemonBin}. Run "yarn build:daemon" first.`,
    );
  }

  const nodeBin = findSystemNode();
  const logFd = openLogFile();
  const child = spawn(nodeBin, [daemonBin], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, AM_DAEMON_PORT: String(port), PATH: getUserShellPath() },
  });
  child.unref();

  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to start daemon: no PID returned.');
  }

  writePidFile(pid);

  // Wait for health
  if (!await waitForHealth(port)) {
    throw new Error(
      `Daemon started (PID ${pid}) but health check failed after 10 seconds.`,
    );
  }

  return { url, wsUrl };
}
