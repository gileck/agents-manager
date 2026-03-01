import { Command } from 'commander';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import * as http from 'http';

const DAEMON_DIR = path.join(os.homedir(), '.agents-manager');
const PID_FILE = path.join(DAEMON_DIR, 'daemon.pid');
const TOKEN_FILE = path.join(DAEMON_DIR, 'daemon.token');

function getDaemonPort(): number {
  const envPort = process.env.AM_DAEMON_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return 3847;
}

function getDaemonBinaryPath(): string {
  // dist-daemon/index.js at the project root
  // __dirname is src/cli/commands/ (source) or dist-cli/cli/commands/ (built) — 3 levels deep
  return path.resolve(__dirname, '../../../dist-daemon/index.js');
}

function ensureDaemonDir(): void {
  if (!fs.existsSync(DAEMON_DIR)) {
    fs.mkdirSync(DAEMON_DIR, { recursive: true });
  }
}

function readPidFile(): number | null {
  try {
    const content = fs.readFileSync(PID_FILE, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function writePidFile(pid: number): void {
  ensureDaemonDir();
  fs.writeFileSync(PID_FILE, String(pid), 'utf-8');
}

function removePidFile(): void {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore if already removed
  }
}

function writeTokenFile(): string {
  ensureDaemonDir();
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(TOKEN_FILE, token, 'utf-8');
  return token;
}

function httpRequest(method: string, urlPath: string, port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, timeout: 3000 },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

async function waitForHealth(port: number, maxAttempts = 15, intervalMs = 500): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { status } = await httpRequest('GET', '/api/health', port);
      if (status === 200) return true;
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function registerDaemonCommands(program: Command): void {
  const daemon = program.command('daemon').description('Manage the agents-manager daemon');

  daemon
    .command('start')
    .description('Start the daemon server')
    .option('-d, --detach', 'Run daemon as a background process')
    .action(async (cmdOpts: { detach?: boolean }) => {
      const port = getDaemonPort();
      const daemonBin = getDaemonBinaryPath();

      if (!fs.existsSync(daemonBin)) {
        console.error(`Daemon binary not found at ${daemonBin}`);
        console.error('Run "yarn build:daemon" first.');
        process.exitCode = 1;
        return;
      }

      // Check if daemon is already running
      try {
        const { status } = await httpRequest('GET', '/api/health', port);
        if (status === 200) {
          console.error(`Daemon is already running on port ${port}.`);
          process.exitCode = 1;
          return;
        }
      } catch {
        // not running — good
      }

      if (cmdOpts.detach) {
        // Detached mode: spawn as background process
        const child = spawn(process.execPath, [daemonBin], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, AM_DAEMON_PORT: String(port) },
        });

        child.unref();

        const pid = child.pid;
        if (!pid) {
          console.error('Failed to start daemon: no PID returned.');
          process.exitCode = 1;
          return;
        }

        writePidFile(pid);
        writeTokenFile();

        console.log(`Starting daemon on port ${port} (PID: ${pid})...`);

        const healthy = await waitForHealth(port);
        if (healthy) {
          console.log(`Daemon started successfully on port ${port} (PID: ${pid}).`);
        } else {
          console.error('Daemon started but health check failed. Check logs for errors.');
          process.exitCode = 1;
        }
      } else {
        // Foreground mode: spawn with inherited stdio
        console.log(`Starting daemon on port ${port} (foreground)...`);
        const child = spawn(process.execPath, [daemonBin], {
          stdio: 'inherit',
          env: { ...process.env, AM_DAEMON_PORT: String(port) },
        });

        await new Promise<void>((resolve) => {
          child.on('exit', (code) => {
            if (code && code !== 0) {
              process.exitCode = code;
            }
            resolve();
          });
        });
      }
    });

  daemon
    .command('stop')
    .description('Stop the running daemon')
    .action(async () => {
      const port = getDaemonPort();
      const pid = readPidFile();

      // Try graceful shutdown via HTTP first
      try {
        console.log('Sending shutdown request...');
        await httpRequest('POST', '/api/shutdown', port);
        console.log('Daemon stopped.');
        removePidFile();
        return;
      } catch {
        // HTTP shutdown failed — try SIGTERM
      }

      if (pid && isProcessRunning(pid)) {
        console.log(`Sending SIGTERM to PID ${pid}...`);
        try {
          process.kill(pid, 'SIGTERM');
          // Wait briefly for process to exit
          for (let i = 0; i < 10; i++) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            if (!isProcessRunning(pid)) break;
          }
          if (isProcessRunning(pid)) {
            console.error(`Daemon (PID ${pid}) did not stop. You may need to kill it manually.`);
            process.exitCode = 1;
          } else {
            console.log('Daemon stopped.');
          }
        } catch (err) {
          console.error(`Failed to kill process ${pid}: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
        }
        removePidFile();
        return;
      }

      console.error('Daemon is not running (no PID file or process not found).');
      removePidFile();
      process.exitCode = 1;
    });

  daemon
    .command('status')
    .description('Check if the daemon is running')
    .action(async () => {
      const port = getDaemonPort();
      const pid = readPidFile();
      const opts = program.opts() as { json?: boolean };

      try {
        const { status, body } = await httpRequest('GET', '/api/health', port);
        if (status === 200) {
          if (opts.json) {
            let healthData: unknown = {};
            try { healthData = JSON.parse(body); } catch { /* ignore */ }
            console.log(JSON.stringify({ running: true, port, pid, health: healthData }, null, 2));
          } else {
            const pidInfo = pid ? ` (PID: ${pid})` : '';
            console.log(`Daemon is running on port ${port}${pidInfo}.`);
          }
          return;
        }
      } catch {
        // not running
      }

      if (opts.json) {
        console.log(JSON.stringify({ running: false, port, pid }, null, 2));
      } else {
        console.log('Daemon is not running.');
      }
    });
}
