import { spawn, type ChildProcess } from 'child_process';
import { createServer } from 'net';
import { get as httpGet } from 'http';
import { getShellEnv } from '../../shared/shell-env';
import type { DevServerInfo } from '../../shared/types';
import type { IDevServerManager } from '../interfaces/dev-server-manager';

const READINESS_TIMEOUT_MS = 60_000;
const READINESS_POLL_MS = 1_000;
const SIGKILL_GRACE_MS = 5_000;
const LOG_BUFFER_MAX = 500;

interface DevServerInstance {
  readonly process: ChildProcess;
  readonly info: DevServerInfo;
  readonly logBuffer: string[];
}

export interface DevServerManagerCallbacks {
  onLog?: (taskId: string, line: string) => void;
  onStatusChange?: (info: DevServerInfo) => void;
}

export class DevServerManager implements IDevServerManager {
  private instances = new Map<string, DevServerInstance>();
  private callbacks: DevServerManagerCallbacks;

  constructor(callbacks: DevServerManagerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async start(taskId: string, projectId: string, worktreePath: string, command: string): Promise<DevServerInfo> {
    const existing = this.instances.get(taskId);
    if (existing && (existing.info.status === 'starting' || existing.info.status === 'ready')) {
      return { ...existing.info };
    }

    const port = await allocateFreePort();
    const info: DevServerInfo = {
      taskId,
      projectId,
      port,
      url: `http://localhost:${port}`,
      status: 'starting',
      startedAt: Date.now(),
      pid: null,
    };

    const env = { ...getShellEnv(), PORT: String(port) };
    const child = spawn(command, { shell: true, cwd: worktreePath, env, stdio: ['ignore', 'pipe', 'pipe'] });

    info.pid = child.pid ?? null;

    const instance: DevServerInstance = { process: child, info, logBuffer: [] };
    this.instances.set(taskId, instance);
    this.emitStatusChange(info);

    const appendLog = (line: string) => {
      instance.logBuffer.push(line);
      if (instance.logBuffer.length > LOG_BUFFER_MAX) {
        instance.logBuffer.shift();
      }
      this.emitLog(taskId, line);
    };

    child.stdout?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        appendLog(line);
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString().split('\n').filter(Boolean)) {
        appendLog(line);
      }
    });

    child.on('error', (err) => {
      info.status = 'error';
      info.error = err.message;
      this.emitStatusChange(info);
    });

    child.on('exit', (code) => {
      if (info.status !== 'stopped') {
        info.status = 'error';
        if (code === 127) {
          info.error = 'Command not found. Check that devServerCommand is correct.';
        } else if (code === 126) {
          info.error = 'Permission denied. Check that devServerCommand is executable.';
        } else {
          info.error = `Process exited with code ${code}`;
        }
        this.emitStatusChange(info);
      }
      this.instances.delete(taskId);
    });

    // Wait for readiness in the background — don't block the response
    pollUntilReady(port, READINESS_TIMEOUT_MS).then(() => {
      if (info.status === 'starting') {
        info.status = 'ready';
        this.emitStatusChange(info);
      }
    }).catch((err) => {
      if (info.status === 'starting') {
        info.status = 'error';
        info.error = err.message === 'Readiness timeout'
          ? `Server did not become ready within ${READINESS_TIMEOUT_MS / 1000}s`
          : `Readiness probe failed: ${err.message}`;
        this.emitStatusChange(info);
        this.killProcess(instance);
        this.instances.delete(taskId);
      }
    });

    return { ...info };
  }

  async stop(taskId: string): Promise<void> {
    const instance = this.instances.get(taskId);
    if (!instance) return;

    instance.info.status = 'stopped';
    this.emitStatusChange(instance.info);
    this.instances.delete(taskId);
    this.killProcess(instance);
  }

  async stopAll(): Promise<void> {
    const taskIds = [...this.instances.keys()];
    await Promise.allSettled(taskIds.map((id) => this.stop(id)));
  }

  getStatus(taskId: string): DevServerInfo | null {
    const info = this.instances.get(taskId)?.info;
    return info ? { ...info } : null;
  }

  list(): DevServerInfo[] {
    return [...this.instances.values()].map((i) => ({ ...i.info }));
  }

  getLogBuffer(taskId: string): string[] {
    return this.instances.get(taskId)?.logBuffer ?? [];
  }

  /** Emit status change safely — callback errors must not crash the daemon. */
  private emitStatusChange(info: DevServerInfo): void {
    try { this.callbacks.onStatusChange?.({ ...info }); } catch { /* swallow callback errors */ }
  }

  /** Emit log line safely — callback errors must not crash the daemon. */
  private emitLog(taskId: string, line: string): void {
    try { this.callbacks.onLog?.(taskId, line); } catch { /* swallow callback errors */ }
  }

  private killProcess(instance: DevServerInstance): void {
    const { process: child } = instance;
    if (!child.pid) return;

    try {
      // Kill the entire process group
      process.kill(-child.pid, 'SIGTERM');
    } catch (err: unknown) {
      // ESRCH = process already dead — safe to ignore
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
        this.emitStatusChange({
          ...instance.info,
          status: 'error',
          error: `Failed to kill process: ${(err as Error).message}`,
        });
      }
    }

    // Fallback SIGKILL after grace period
    const killTimer = setTimeout(() => {
      try {
        if (!child.killed) {
          process.kill(-child.pid!, 'SIGKILL');
        }
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') {
          // Non-ESRCH error on SIGKILL — nothing more we can do
        }
      }
    }, SIGKILL_GRACE_MS);
    killTimer.unref();
  }
}

async function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to allocate port')));
      }
    });
    server.on('error', reject);
  });
}

async function pollUntilReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const isReady = await probePort(port);
    if (isReady) return;
    await sleep(READINESS_POLL_MS);
  }

  throw new Error('Readiness timeout');
}

function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpGet(`http://127.0.0.1:${port}/`, (res) => {
      res.resume(); // drain the response
      // Any response (2xx, 3xx, 4xx, 5xx) means the server is up
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
