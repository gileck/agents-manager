/**
 * Dev daemon runner — builds daemon with esbuild, runs with node,
 * watches src/ for changes and auto-restarts (skipping when agents are running).
 * With --web flag, also starts webpack-dev-server after daemon is healthy.
 *
 * Usage: npx tsx scripts/dev-daemon.ts [--web]
 */
import { spawn, execSync, type ChildProcess } from 'child_process';
import { watch } from 'fs';
import path from 'path';
import http from 'http';

const PORT = parseInt(process.env.AM_DAEMON_PORT ?? '3847', 10);
const ROOT_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT_DIR, 'src');
const WEBPACK_BIN = path.join(ROOT_DIR, 'node_modules', '.bin', 'webpack');
const DAEMON_BUNDLE = path.join(ROOT_DIR, 'dist-daemon', 'index.js');
const SQLITE_BINDING = path.join(ROOT_DIR, 'node_modules/better-sqlite3/build-node/Release/better_sqlite3.node');
const DEBOUNCE_MS = 500;
const WITH_WEB = process.argv.includes('--web');

// Backend dirs that require daemon restart
const BACKEND_DIRS = ['core/', 'daemon/', 'shared/', 'cli/'];

// esbuild command (same as package.json build:daemon)
const ESBUILD_CMD = `node_modules/.bin/esbuild src/daemon/index.ts --bundle --platform=node --outfile=dist-daemon/index.js --external:better-sqlite3 --external:node-telegram-bot-api --external:sharp`;

let daemon: ChildProcess | null = null;
let webServer: ChildProcess | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let restarting = false;

function log(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`\x1b[36m[dev-daemon ${ts}]\x1b[0m ${msg}`);
}

function warn(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`\x1b[33m[dev-daemon ${ts}]\x1b[0m ${msg}`);
}

function err(msg: string) {
  const ts = new Date().toLocaleTimeString();
  console.log(`\x1b[31m[dev-daemon ${ts}]\x1b[0m ${msg}`);
}

/** Check daemon health — resolves true if healthy */
function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

/** Wait for daemon to be healthy, with timeout */
async function waitForHealth(timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkHealth()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/** Fetch a JSON array from a daemon endpoint, optionally filtering by a field value */
function countJsonArray(urlPath: string, filterField?: string, filterValue?: string): Promise<number> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}${urlPath}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const items = JSON.parse(data);
          if (!Array.isArray(items)) return resolve(0);
          if (filterField && filterValue) {
            resolve(items.filter((i) => i[filterField] === filterValue).length);
          } else {
            resolve(items.length);
          }
        } catch {
          resolve(0);
        }
      });
    });
    req.on('error', () => resolve(0));
    req.setTimeout(2000, () => { req.destroy(); resolve(0); });
  });
}

/** Check if any agents (task pipeline or chat thread) are currently running */
async function checkActiveAgents(): Promise<number> {
  const [taskAgents, chatAgents] = await Promise.all([
    countJsonArray('/api/agent-runs/active'),
    // /api/chat/agents returns completed/failed agents too — filter to running only
    countJsonArray('/api/chat/agents', 'status', 'running'),
  ]);
  return taskAgents + chatAgents;
}

/** Build daemon with esbuild (fast ~200ms) */
function buildDaemon(): boolean {
  try {
    execSync(ESBUILD_CMD, { cwd: ROOT_DIR, stdio: 'pipe' });
    return true;
  } catch (e) {
    err(`Build failed: ${(e as Error).message}`);
    return false;
  }
}

function killPortProcess() {
  try {
    const pids = execSync(`lsof -ti:${PORT}`, { encoding: 'utf8' }).trim();
    if (pids) {
      execSync(`kill -9 ${pids}`, { stdio: 'pipe' });
      log(`Killed stale process(es) on port ${PORT}`);
    }
  } catch { /* no process on port */ }
}

function startDaemon() {
  killPortProcess();

  if (!buildDaemon()) {
    warn('Skipping daemon start due to build failure');
    return;
  }

  daemon = spawn('node', [DAEMON_BUNDLE], {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      BETTER_SQLITE3_BINDING: SQLITE_BINDING,
      AM_VERBOSE: '1',
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

function startWebServer() {
  if (webServer) return;
  log('Starting webpack dev server...');
  webServer = spawn(WEBPACK_BIN, [
    'serve', '--config', path.join(ROOT_DIR, 'config', 'webpack.web.config.js'),
  ], {
    stdio: 'inherit',
    cwd: ROOT_DIR,
    env: process.env,
  });

  webServer.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM') {
      log(`Web dev server exited (code=${code}, signal=${signal})`);
    }
    webServer = null;
  });
}

function stopDaemon(): Promise<void> {
  return new Promise((resolve) => {
    if (!daemon) return resolve();
    let exited = false;
    daemon.on('exit', () => { exited = true; resolve(); });
    daemon.kill('SIGTERM');
    // SIGKILL fallback — daemon.killed is true right after .kill(), so track exit state instead
    setTimeout(() => {
      if (!exited && daemon) {
        warn('Daemon did not exit after SIGTERM — sending SIGKILL');
        daemon.kill('SIGKILL');
      }
    }, 5000);
    // Safety: resolve even if exit event never fires (e.g. zombie process)
    setTimeout(() => {
      if (!exited) {
        warn('Daemon exit event never fired — force-continuing restart');
        resolve();
      }
    }, 7000);
  });
}

function stopWebServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!webServer) return resolve();
    webServer.on('exit', () => resolve());
    webServer.kill('SIGTERM');
    setTimeout(() => {
      if (webServer && !webServer.killed) {
        webServer.kill('SIGKILL');
      }
    }, 3000);
  });
}

async function handleChange(filename: string | null) {
  if (restartTimer) clearTimeout(restartTimer);

  restartTimer = setTimeout(async () => {
    restartTimer = null;
    if (restarting) return;

    const activeCount = await checkActiveAgents();
    if (activeCount > 0) {
      warn(`Skipping restart — ${activeCount} agent(s) running. Save again after agents finish.`);
      return;
    }

    restarting = true;
    log(`Change detected${filename ? ` (${filename})` : ''} — rebuilding & restarting daemon...`);
    await stopDaemon();
    startDaemon();
    restarting = false;
  }, DEBOUNCE_MS);
}

async function main() {
  startDaemon();

  // Watch src/ recursively — only restart daemon for backend changes
  watch(SRC_DIR, { recursive: true }, (_event, filename) => {
    if (filename && /\.(ts|tsx)$/.test(filename)) {
      if (!BACKEND_DIRS.some((dir) => filename.startsWith(dir))) return;
      handleChange(filename);
    }
  });

  log(`Watching ${SRC_DIR} for changes...`);
  log('Press \x1b[1mr\x1b[0m to restart daemon');

  // Listen for 'r' keypress to manually restart
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (data) => {
      const key = data.toString();
      if (key === 'r' || key === 'R') {
        handleChange(null);
      } else if (key === '\x03') {
        // Ctrl+C
        shutdown();
      }
    });
  }

  if (WITH_WEB) {
    log('Waiting for daemon to be healthy...');
    const healthy = await waitForHealth();
    if (healthy) {
      log('Daemon is healthy');
      startWebServer();
    } else {
      warn('Daemon failed to become healthy within 15s — starting web server anyway');
      startWebServer();
    }
  }
}

main();

// Forward signals — clean up both processes
const shutdown = async () => {
  log('Shutting down...');
  if (restartTimer) clearTimeout(restartTimer);
  await Promise.all([stopWebServer(), stopDaemon()]);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
