/**
 * Auto-start the daemon if it is not already running.
 *
 * 1. Probe GET /api/health on the configured port.
 * 2. If the daemon responds 200, return the base URL.
 * 3. Otherwise spawn the daemon binary as a detached child, wait for the
 *    health check to pass, then return the base URL.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';

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
  return path.join(findProjectRoot(), 'dist-daemon', 'index.js');
}

function ensureDaemonDir(): void {
  if (!fs.existsSync(DAEMON_DIR)) {
    fs.mkdirSync(DAEMON_DIR, { recursive: true });
  }
}

function writePidFile(pid: number): void {
  ensureDaemonDir();
  const pidFile = path.join(DAEMON_DIR, 'daemon.pid');
  fs.writeFileSync(pidFile, String(pid), 'utf-8');
}

function httpHealthCheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: '/api/health', method: 'GET', timeout: 3000 },
      (res) => {
        // Consume data
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode === 200));
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function waitForHealth(port: number, maxAttempts = 30, intervalMs = 500): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    const ok = await httpHealthCheck(port);
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/**
 * Ensure the daemon is running and return its base URL
 * (e.g. `http://127.0.0.1:3847`).
 */
export async function ensureDaemon(): Promise<string> {
  const port = getDaemonPort();
  const baseUrl = `http://127.0.0.1:${port}`;

  // 1. Check if daemon is already running
  const running = await httpHealthCheck(port);
  if (running) return baseUrl;

  // 2. Spawn daemon as a detached background process
  const daemonBin = getDaemonBinaryPath();
  if (!fs.existsSync(daemonBin)) {
    throw new Error(
      `Daemon binary not found at ${daemonBin}. Run "yarn build:daemon" first.`,
    );
  }

  const child = spawn(process.execPath, [daemonBin], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AM_DAEMON_PORT: String(port) },
  });
  child.unref();

  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to start daemon: no PID returned.');
  }

  writePidFile(pid);

  // 3. Wait for health check to pass
  const healthy = await waitForHealth(port);
  if (!healthy) {
    throw new Error(
      `Daemon started (PID ${pid}) but health check failed after 15 seconds. Check daemon logs.`,
    );
  }

  return baseUrl;
}
