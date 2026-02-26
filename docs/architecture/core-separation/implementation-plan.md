# Implementation Plan: Separate Core Business Logic from UI

## Overview

This plan splits the work into 4 incremental PRs. Each PR leaves the app fully functional.

| PR | Goal | Outcome |
|----|------|---------|
| **PR 1** | Decouple Electron imports from business logic | All business logic files are pure Node.js |
| **PR 2** | Move files to `src/core/` | Clean architectural boundary |
| **PR 3** | Build the daemon server | Daemon runs independently, exposes REST + WS API |
| **PR 4** | Convert Electron + CLI to thin clients | All UIs use daemon API |

---

## PR 1: Decouple Electron Imports from Business Logic (No File Moves)

**Goal:** Remove all `@template/*` and `electron` imports from business logic files so they become pure Node.js. No files are moved — only import patterns change.

### Phase 0: Make `agent-handler.ts` Injectable

**Problem:** `src/main/handlers/agent-handler.ts` imports `sendToRenderer` from `@template/main/core/window` — a pipeline hook (core logic) depends on Electron window messaging.

**Solution:** Make streaming callbacks injectable via `AgentHandlerDeps`.

**Files to change:**

1. **`src/main/handlers/agent-handler.ts`**
   - Remove: `import { sendToRenderer } from '@template/main/core/window'`
   - Remove: `import { IPC_CHANNELS } from '../../shared/ipc-channels'`
   - Add to `AgentHandlerDeps`:
     ```typescript
     createStreamingCallbacks?: (taskId: string) => {
       onOutput: (chunk: string) => void;
       onMessage: (msg: string) => void;
       onStatus: (status: string) => void;
     };
     ```
   - Replace direct `sendToRenderer` calls with:
     ```typescript
     const callbacks = deps.createStreamingCallbacks?.(task.id);
     deps.workflowService.startAgent(
       task.id, mode, agentType,
       (chunk) => { try { callbacks?.onOutput(chunk); } catch { /* */ } },
       (msg) => { try { callbacks?.onMessage(msg); } catch { /* */ } },
       (status) => { try { callbacks?.onStatus(status); } catch { /* */ } },
     )
     ```

2. **`src/main/providers/setup.ts`**
   - Add `AppServicesConfig` interface:
     ```typescript
     export interface AppServicesConfig {
       createStreamingCallbacks?: (taskId: string) => {
         onOutput: (chunk: string) => void;
         onMessage: (msg: string) => void;
         onStatus: (status: string) => void;
       };
     }
     ```
   - Change signature: `createAppServices(db, config?: AppServicesConfig)`
   - Pass `config.createStreamingCallbacks` to `registerAgentHandler`

3. **`src/main/index.ts`**
   - Pass streaming callback factory when creating services:
     ```typescript
     services = createAppServices(db, {
       createStreamingCallbacks: (taskId) => ({
         onOutput: (chunk) => sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, chunk),
         onMessage: (msg) => sendToRenderer(IPC_CHANNELS.AGENT_MESSAGE, taskId, msg),
         onStatus: (status) => sendToRenderer(IPC_CHANNELS.AGENT_STATUS, taskId, status),
       }),
     });
     ```

### Phase 1: Fix `telegram-bot-service.ts`

**Problem:** Imports `getSetting` from `@template/main/services/settings-service`.

**Solution:** Accept the default pipeline ID as a constructor parameter.

**Files to change:**

1. **`src/main/services/telegram-bot-service.ts`**
   - Remove: `import { getSetting } from '@template/main/services/settings-service'`
   - Add `defaultPipelineId?: string` to `BotDeps` interface
   - Replace `getSetting('default_pipeline_id', '')` with `this.deps.defaultPipelineId ?? ''`

2. **`src/main/ipc-handlers.ts`** (where `TelegramBotService` is constructed)
   - Pass `defaultPipelineId: getSetting('default_pipeline_id', '')` when constructing the deps object

### Phase 2: Fix `item-service.ts`

**Problem:** Imports `getDatabase()` and `generateId()` from `@template/main/services/database`.

**Solution:** Accept `db` as a parameter and use `crypto.randomUUID()`.

**Files to change:**

1. **`src/main/services/item-service.ts`**
   - Remove: `import { getDatabase, generateId } from '@template/main/services/database'`
   - Add: `import { randomUUID } from 'crypto'`
   - Change every exported function to accept `db: Database.Database` as first parameter
   - Replace `generateId()` with `randomUUID()`

2. **`src/main/ipc-handlers.ts`**
   - Update all `itemService.*()` calls to pass `services.db` as first argument

### Phase 3: Fix `migrations.ts` Type Import

**Problem:** Imports `Migration` type from `@template/main/services/database`.

**Solution:** Define the type locally.

**Files to change:**

1. **`src/main/migrations.ts`**
   - Remove: `import type { Migration } from '@template/main/services/database'`
   - Add locally:
     ```typescript
     export interface Migration { name: string; sql: string; }
     ```

### Phase 4: Make `setup.ts` Notification Router Pluggable

**Problem:** `setup.ts` has a dynamic `require('../services/desktop-notification-router')` that would break after the file move in PR 2.

**Solution:** Accept notification routers via config instead of dynamic require.

**Files to change:**

1. **`src/main/providers/setup.ts`**
   - Add to `AppServicesConfig`:
     ```typescript
     notificationRouters?: INotificationRouter[];
     ```
   - Remove the `try { require(...) }` block
   - Use `config?.notificationRouters` instead

2. **`src/main/index.ts`**
   - Import `DesktopNotificationRouter` and pass it via config

### PR 1 Verification

```bash
yarn checks   # TypeScript compiles, ESLint passes
yarn test      # All tests pass
# Manual: Electron app starts, agent streaming works
# Manual: CLI works (npx agents-manager tasks list)
```

---

## PR 2: Move Files to `src/core/` + Update All References

**Goal:** Physically move all pure business logic files from `src/main/` to `src/core/`.

### Phase 5: Create `src/core/` and Move ~81 Files

| Source | Destination | Count |
|--------|------------|-------|
| `src/main/agents/*` | `src/core/agents/*` | 5 |
| `src/main/data/*` | `src/core/data/*` | 1 |
| `src/main/handlers/*` | `src/core/handlers/*` | 7 |
| `src/main/interfaces/*` | `src/core/interfaces/*` | 26 |
| `src/main/providers/*` | `src/core/providers/*` | 1 |
| `src/main/services/*` (pure) | `src/core/services/*` | 24 + timeline/ |
| `src/main/stores/*` | `src/core/stores/*` | 16 |
| `src/main/migrations.ts` | `src/core/migrations.ts` | 1 |

**Stays in `src/main/`:** `index.ts`, `ipc-handlers.ts`, `services/desktop-notification-router.ts`, `services/electron-notification-router.ts`

**Internal imports:** No changes needed — relative structure is preserved.

### Phase 6: Update Imports in Non-Moved Files

1. **`src/main/index.ts`** — `./providers/setup` → `../core/providers/setup`, etc.
2. **`src/main/ipc-handlers.ts`** — ~15 import path updates from `./` to `../core/`
3. **`src/main/services/desktop-notification-router.ts`** — `../interfaces/` → `../../core/interfaces/`
4. **`src/main/services/electron-notification-router.ts`** — same pattern
5. **`src/cli/db.ts`** — `../main/migrations` → `../core/migrations`, etc.
6. **`src/cli/index.ts`** — `../main/providers/setup` → `../core/providers/setup`
7. **`src/cli/context.ts`** — same pattern

### Phase 7: Update Test Imports

Global find-and-replace: `../../src/main/` → `../../src/core/`
- Affects **31 test files**, **91 import statements**

### Phase 8: Update Build Configuration

1. **`config/tsconfig.main.json`** — add `"../src/core/**/*"` to include
2. **`config/tsconfig.cli.json`** — add `"../src/core/**/*"` to include
3. **`tsconfig.json`** — add `"@core/*": ["src/core/*"]` path alias
4. **`vitest.config.ts`** — add `@core` alias

### PR 2 Verification

```bash
yarn checks && yarn test
# Manual: Electron app starts, CLI works
```

**Enforcement:** Add ESLint rule or CI check: no file in `src/core/` imports from `electron`, `@template/*`, or `src/main/`.

---

## PR 3: Build the Daemon Server

**Goal:** Create a standalone Node.js server that hosts all business logic and exposes REST + WebSocket API.

### Phase 9: Create `src/daemon/` Directory Structure

```
src/daemon/
  index.ts                    # Entry point: start HTTP + WS server
  server.ts                   # Express/Fastify app setup
  routes/                     # REST route handlers
    projects.ts
    tasks.ts
    agents.ts
    pipelines.ts
    events.ts
    prompts.ts
    artifacts.ts
    features.ts
    kanban.ts
    agent-definitions.ts
    git.ts
    telegram.ts
    chat.ts
    settings.ts
    dashboard.ts
    items.ts
    health.ts
  ws/                         # WebSocket handling
    ws-server.ts              # WS server setup + subscription manager
    channels.ts               # Channel definitions + broadcast helpers
  middleware/
    auth.ts                   # Token-based auth (optional)
    validation.ts             # Request validation (port of validateId/validateInput)
  lifecycle.ts                # Startup, shutdown, supervisor management
```

### Phase 10: Shared Database Initialization

**Prerequisite for all daemon phases.** Move the DB setup from CLI's `db.ts` to a shared location usable by both daemon and CLI:

```
src/core/
  db.ts                          # Shared DB initialization (open, migrate, WAL mode)
```

This is essentially the current `src/cli/db.ts` logic (open SQLite, run migrations, enable WAL + foreign keys) extracted to `src/core/db.ts`. Both the daemon and CLI import from it. The CLI's `db.ts` becomes a thin re-export or is deleted.

### Phase 11: Implement the HTTP Server

**Entry point: `src/daemon/index.ts`**

```typescript
import { openDatabase } from '../core/db';   // Shared DB setup (from Phase 10)
import { createAppServices } from '../core/providers/setup';
import { createServer } from './server';

const PORT = parseInt(process.env.AM_DAEMON_PORT ?? '3847', 10);

const { db, services } = openDatabase();
const { app, wsServer } = createServer(services);

// Start supervisors (just like src/main/index.ts does today)
services.agentSupervisor.start();
services.workflowReviewSupervisor.start(5 * 60 * 1000);

// Recover orphaned runs
services.agentService.recoverOrphanedRuns().catch(console.error);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Daemon listening on http://127.0.0.1:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());

function shutdown() {
  services.agentSupervisor.stop();
  wsServer.close();
  db.close();
  process.exit(0);
}
```

### Phase 12: Implement REST Routes

Each route file follows a consistent pattern — thin handler that delegates to core services:

```typescript
// src/daemon/routes/tasks.ts
import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';

export function taskRoutes(services: AppServices): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const filter = req.query; // projectId, status, etc.
    const tasks = await services.taskStore.listTasks(filter);
    res.json(tasks);
  });

  router.get('/:id', async (req, res) => {
    const task = await services.taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  router.post('/', async (req, res) => {
    const task = await services.workflowService.createTask(req.body);
    res.status(201).json(task);
  });

  router.post('/:id/transition', async (req, res) => {
    const result = await services.workflowService.transitionTask(
      req.params.id, req.body.toStatus, req.body.actor,
    );
    res.json(result);
  });

  // ... etc for all task endpoints

  return router;
}
```

**Approach:** Mechanically port each IPC handler from `src/main/ipc-handlers.ts` to a REST route. The logic is identical — validate inputs, call service, return result. The only difference is the transport (HTTP instead of IPC).

### Phase 13: Implement WebSocket Server

```typescript
// src/daemon/ws/ws-server.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

interface Subscription { channel: string; id?: string; }

export class DaemonWsServer {
  private wss: WebSocketServer;
  private subscriptions = new Map<WebSocket, Set<string>>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }

  // Broadcast to all clients subscribed to a channel
  broadcast(channel: string, id: string | undefined, data: unknown): void {
    const key = id ? `${channel}:${id}` : channel;
    const wildcard = `${channel.split(':')[0]}:*:${id}`;
    const globalWildcard = '*';

    for (const [ws, subs] of this.subscriptions) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      if (subs.has(key) || subs.has(wildcard) || subs.has(globalWildcard)) {
        ws.send(JSON.stringify({ channel, id, data }));
      }
    }
  }

  // Create a callback factory that broadcasts via WS
  // This replaces sendToRenderer throughout the codebase
  createStreamingCallbacks(taskId: string) {
    return {
      onOutput: (chunk: string) => this.broadcast('agent:output', taskId, chunk),
      onMessage: (msg: string) => this.broadcast('agent:message', taskId, msg),
      onStatus: (status: string) => this.broadcast('agent:status', taskId, status),
    };
  }

  private handleConnection(ws: WebSocket): void {
    this.subscriptions.set(ws, new Set());

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const subs = this.subscriptions.get(ws)!;
      const key = msg.id ? `${msg.channel}:${msg.id}` : msg.channel;

      if (msg.type === 'subscribe') subs.add(key);
      if (msg.type === 'unsubscribe') subs.delete(key);
    });

    ws.on('close', () => this.subscriptions.delete(ws));
  }

  close(): void { this.wss.close(); }
}
```

### Phase 14: Wire Streaming to WebSocket

The daemon passes WS-based streaming callbacks to core services:

```typescript
// In src/daemon/server.ts
const wsServer = new DaemonWsServer(httpServer);

const services = createAppServices(db, {
  createStreamingCallbacks: (taskId) => wsServer.createStreamingCallbacks(taskId),
});
```

For chat and task-chat streaming, the route handlers pass WS broadcast callbacks:

```typescript
// POST /api/chat/sessions/:id/send
router.post('/sessions/:id/send', async (req, res) => {
  const sessionId = req.params.id;
  const result = await services.chatAgentService.send(
    sessionId,
    req.body.message,
    (chunk) => wsServer.broadcast('chat:output', sessionId, chunk),
    (msg) => wsServer.broadcast('chat:message', sessionId, msg),
  );
  res.json(result);
});
```

### Phase 15: Daemon CLI Commands

Add daemon management commands:

```bash
agents-manager daemon start          # Start daemon in foreground
agents-manager daemon start -d       # Start daemon in background (detached)
agents-manager daemon stop           # Stop running daemon
agents-manager daemon status         # Check if daemon is running
agents-manager daemon logs           # Tail daemon logs
```

Implementation:
- Background mode: spawn detached child process, write PID to `~/.agents-manager/daemon.pid`
- Status: check PID file + health endpoint
- Stop: send SIGTERM to PID or call `POST /api/shutdown`
- Logs: write to `~/.agents-manager/daemon.log`, tail with `--follow`

### PR 3 Verification

```bash
yarn checks && yarn test

# Start daemon
node dist-daemon/index.js

# Test REST API
curl http://localhost:3847/api/health
curl http://localhost:3847/api/projects
curl http://localhost:3847/api/tasks?projectId=...

# Test WebSocket (use wscat or similar)
wscat -c ws://localhost:3847/ws
> {"type":"subscribe","channel":"agent:output","id":"task-123"}

# Existing Electron app still works (it still uses IPC directly at this point)
```

---

## PR 4: Convert Electron + CLI to Thin Clients

**Goal:** All UIs connect to the daemon instead of importing core services directly.

### Phase 16: Create Shared Client SDK

```
src/client/
  api-client.ts               # Typed REST client
  ws-client.ts                # WebSocket subscription client
  index.ts                    # Exports
```

The client SDK provides typed methods for every endpoint:

```typescript
export function createApiClient(baseUrl: string) {
  return {
    tasks: {
      list: (filter?) => get(`${baseUrl}/api/tasks`, filter),
      get: (id) => get(`${baseUrl}/api/tasks/${id}`),
      create: (input) => post(`${baseUrl}/api/tasks`, input),
      update: (id, input) => patch(`${baseUrl}/api/tasks/${id}`, input),
      delete: (id) => del(`${baseUrl}/api/tasks/${id}`),
      transition: (id, toStatus, actor?) => post(`${baseUrl}/api/tasks/${id}/transition`, { toStatus, actor }),
      // ... etc
    },
    agents: { ... },
    projects: { ... },
    chat: { ... },
    // ... etc
  };
}
```

### Phase 17: Convert Electron App to Thin Client

**`src/main/ipc-handlers.ts`** — Replace direct service calls with API client calls:

```typescript
// Before:
registerIpcHandler(IPC_CHANNELS.TASK_LIST, async (_, filter) => {
  return services.taskStore.listTasks(filter);
});

// After:
registerIpcHandler(IPC_CHANNELS.TASK_LIST, async (_, filter) => {
  return apiClient.tasks.list(filter);
});
```

**`src/main/index.ts`** — Remove `createAppServices()`, remove supervisor startup. Instead:
1. Ensure daemon is running (auto-start if not)
2. Create API client pointing to daemon
3. Connect WebSocket for streaming
4. Forward WS events to renderer via `sendToRenderer`

```typescript
// src/main/index.ts (after conversion)
import { createApiClient } from '../client/api-client';
import { createWsClient } from '../client/ws-client';

const api = createApiClient('http://localhost:3847');
const ws = createWsClient('ws://localhost:3847/ws');

// Forward all WS events to renderer
ws.onMessage((channel, id, data) => {
  const ipcChannel = wsChannelToIpc(channel); // map back to IPC_CHANNELS
  sendToRenderer(ipcChannel, id, data);
});

registerIpcHandlers(api, ws);
```

The Electron app no longer imports anything from `src/core/`. It only imports from `src/client/`.

### Phase 18: Convert CLI to Thin Client

The CLI has two options:

**Option A: CLI talks to daemon (requires daemon running)**
```typescript
// src/cli/index.ts
import { createApiClient } from '../client/api-client';

const api = createApiClient(`http://localhost:${port}`);

// All commands use api client
registerTaskCommands(program, api);
```

**Option B: CLI can work both ways**
- If daemon is running → use API client (supports streaming, shared state)
- If daemon is not running → import `src/core/` directly (offline mode, read-only safe operations)

Option B is more resilient. The CLI detects daemon availability on startup:

```typescript
const daemon = await checkDaemon(); // GET /api/health
if (daemon) {
  const api = createApiClient(daemon.url);
  registerCommands(program, { mode: 'client', api });
} else {
  const { db, services } = openDatabase();
  registerCommands(program, { mode: 'direct', services });
}
```

### Phase 19: Auto-Start Daemon from Electron

When the Electron app starts, ensure the daemon is running:

```typescript
async function ensureDaemon(): Promise<string> {
  const url = 'http://localhost:3847';
  try {
    await fetch(`${url}/api/health`);
    return url; // Already running
  } catch {
    // Start daemon as detached child process
    const daemonPath = path.join(__dirname, '../../dist-daemon/index.js');
    const child = spawn('node', [daemonPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    // Wait for it to be ready
    await waitForHealth(url);
    return url;
  }
}
```

### Phase 20: Remove Direct Core Imports from Electron

After PR 4, `src/main/` should have:
- **Zero** imports from `src/core/`
- Only imports from `src/client/`, `src/shared/`, `electron`, `@template/*`

The Electron app is now a pure thin client.

### PR 4 Verification

```bash
yarn checks && yarn test

# Test full flow:
# 1. Start daemon
agents-manager daemon start

# 2. Start Electron app (auto-detects daemon)
yarn start

# 3. Open web UI (if built)
open http://localhost:3847  # or separate web UI port

# 4. Use CLI
agents-manager tasks list --project <id>

# 5. Start an agent from Electron, close Electron, reopen — agent is still running
# 6. Start an agent from CLI, see output in Electron
```

---

## Final Architecture After All PRs

```
src/
  core/                          # Pure business logic (zero deps on UI/Electron)
    agents/                      # Agent implementations
    data/                        # Seeded pipelines
    db.ts                        # Shared DB initialization
    handlers/                    # Pipeline hooks
    interfaces/                  # All contracts
    migrations.ts                # DB migrations
    providers/setup.ts           # Composition root
    services/                    # All services
    stores/                      # All SQLite stores

  daemon/                        # Daemon server (imports core/)
    index.ts                     # Entry point
    server.ts                    # HTTP + WS setup
    routes/                      # REST handlers (thin — delegate to core)
    ws/                          # WebSocket server + subscriptions
    middleware/                  # Auth, validation
    lifecycle.ts                 # Startup/shutdown

  client/                        # Shared API client SDK
    api-client.ts                # Typed REST client
    ws-client.ts                 # WebSocket subscription client

  main/                          # Electron (thin client)
    index.ts                     # Bootstrap, ensure daemon, connect
    ipc-handlers.ts              # IPC → API client delegation
    services/                    # Electron-only (notifications)

  cli/                           # CLI (thin client)
    index.ts                     # Entry point
    commands/                    # CLI commands → API client

  shared/                        # Shared types
  renderer/                      # React UI (unchanged — uses window.api)
  preload/                       # Electron preload bridge
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Broken imports after file moves (PR 2) | Low | High | `yarn checks` after every phase |
| Tests fail due to path changes (PR 2) | Low | Medium | Mechanical find-replace |
| Daemon port conflicts | Low | Low | Configurable port, PID file lock |
| WebSocket message ordering | Medium | Medium | Each stream is per-task/session; ordering within a stream is guaranteed by WS |
| Daemon crash loses agent state | Medium | High | Agent runs are in SQLite; daemon restart recovers via `recoverOrphanedRuns()` |
| Performance overhead of HTTP vs IPC | Low | Low | Local HTTP is <1ms overhead; streaming uses WS (zero overhead vs IPC) |
| Electron auto-start race condition | Medium | Low | Health check with retry + backoff |
| CLI offline mode complexity | Medium | Low | Start with daemon-required; add offline mode later if needed |

## Dependency Graph

```
PR 1 ──→ PR 2 ──→ PR 3 ──→ PR 4
                     │
                     └──→ (Web UI can be built anytime after PR 3)
```

After PR 3, a web UI can be built independently since the daemon API is available. PR 4 (converting Electron to thin client) can happen in parallel with web UI development.
