/**
 * Dev daemon runner — watches src/ for changes and auto-restarts the daemon,
 * but skips restart when agents are actively running.
 *
 * Usage: npx tsx scripts/dev-daemon.ts
 */
import { spawn, type ChildProcess } from 'child_process';
import { watch } from 'fs';
import path from 'path';
import http from 'http';

const PORT = parseInt(process.env.AM_DAEMON_PORT ?? '3847', 10);
const SRC_DIR = path.resolve(__dirname, '..', 'src');
const DEBOUNCE_MS = 500;

let daemon: ChildProcess | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`\x1b[36m[dev-daemon ${ts}]\x1b[0m ${msg}`);
}

function warn(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`\x1b[33m[dev-daemon ${ts}]\x1b[0m ${msg}`);
}

/** Check if agents are currently running via the daemon API */
function checkActiveAgents(): Promise<number> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/agent-runs/active`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const runs = JSON.parse(data);
          resolve(Array.isArray(runs) ? runs.length : 0);
        } catch {
          resolve(0);
        }
      });
    });
    req.on('error', () => resolve(0)); // daemon not responding = no agents
    req.setTimeout(2000, () => { req.destroy(); resolve(0); });
  });
}

function startDaemon() {
  daemon = spawn('node', [
    '--import', 'tsx',
    path.resolve(SRC_DIR, 'daemon', 'index.ts'),
  ], {
    stdio: 'inherit',
    env: {
      ...process.env,
      BETTER_SQLITE3_BINDING: 'node_modules/better-sqlite3/build-node/Release/better_sqlite3.node',
    },
  });

  daemon.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM') {
      log(`Daemon exited (code=${code}, signal=${signal})`);
    }
    daemon = null;
  });

  log('Daemon started (pid=' + daemon.pid + ')');
}

function stopDaemon(): Promise<void> {
  return new Promise((resolve) => {
    if (!daemon) return resolve();
    daemon.on('exit', () => resolve());
    daemon.kill('SIGTERM');
    // Force kill after 5s if graceful shutdown stalls
    setTimeout(() => {
      if (daemon && !daemon.killed) {
        daemon.kill('SIGKILL');
      }
    }, 5000);
  });
}

async function handleChange(filename: string | null) {
  if (restartTimer) clearTimeout(restartTimer);

  restartTimer = setTimeout(async () => {
    restartTimer = null;

    const activeCount = await checkActiveAgents();
    if (activeCount > 0) {
      warn(`Skipping restart — ${activeCount} agent(s) running. Save again after agents finish.`);
      return;
    }

    log(`Change detected${filename ? ` (${filename})` : ''} — restarting daemon...`);
    await stopDaemon();
    startDaemon();
  }, DEBOUNCE_MS);
}

// Start daemon
startDaemon();

// Watch src/ recursively for changes
watch(SRC_DIR, { recursive: true }, (_event, filename) => {
  // Only watch TS files
  if (filename && /\.(ts|tsx)$/.test(filename)) {
    handleChange(filename);
  }
});

log(`Watching ${SRC_DIR} for changes...`);

// Forward signals to daemon
process.on('SIGINT', async () => {
  log('Shutting down...');
  if (restartTimer) clearTimeout(restartTimer);
  await stopDaemon();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  if (restartTimer) clearTimeout(restartTimer);
  await stopDaemon();
  process.exit(0);
});
