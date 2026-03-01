# Implementation Plan: Separate Core Business Logic from UI

## Overview

This plan splits the work into **5 incremental PRs**. Each PR leaves the app fully functional.

| PR | Goal | Outcome |
|----|------|---------|
| **PR 1** | Decouple Electron imports from business logic | All business logic files are pure Node.js |
| **PR 2** | Move files to `src/core/` | Clean architectural boundary |
| **PR 3a** | Daemon infrastructure | Daemon process starts, health endpoint responds, WS server runs |
| **PR 3b** | Port all routes + wire streaming | Full REST + WebSocket API, daemon is feature-complete |
| **PR 4** | Convert Electron + CLI to thin clients | All UIs use daemon API instead of direct imports |

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Settings storage | SQLite table | Consistent with all other data; daemon has no access to Electron's settings service |
| HTTP framework | Express | Familiar, simple, performance irrelevant for local daemon |
| Daemon build | esbuild single-file bundle | One output file to spawn, clean dependency boundary |
| CLI mode | Daemon-required + auto-start | One code path, no concurrent SQLite writer risk |
| Telegram bot callbacks | Wire at daemon startup | Always works regardless of client connections |

---

## PR 1: Decouple Electron Imports from Business Logic (No File Moves)

**Goal:** Remove all `@template/*` and `electron` imports from business logic files so they become pure Node.js. No files are moved — only import patterns change.

### Phase 0: Make `agent-handler.ts` Injectable

**Problem:** `src/main/handlers/agent-handler.ts` uses a dynamic require of `sendToRenderer` from `@template/main/core/window` — a pipeline hook (core logic) depends on Electron window messaging.

**Solution:** Make streaming callbacks injectable via `AgentHandlerDeps`.

**Files to change:**

1. **`src/main/handlers/agent-handler.ts`**
   - Remove: `const { sendToRenderer } = require('@template/main/core/window')`
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
     // Pass callbacks?.onOutput, callbacks?.onMessage, callbacks?.onStatus
     // to workflowService.startAgent()
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

**Checklist:**
- [ ] Remove `sendToRenderer` dynamic require from `agent-handler.ts`
- [ ] Remove `IPC_CHANNELS` import from `agent-handler.ts`
- [ ] Add `createStreamingCallbacks` to `AgentHandlerDeps`
- [ ] Replace `sendToRenderer` calls with injectable callbacks
- [ ] Add `AppServicesConfig` interface to `setup.ts`
- [ ] Update `createAppServices` signature to accept config
- [ ] Pass `createStreamingCallbacks` from `setup.ts` to `registerAgentHandler`
- [ ] Wire Electron-specific callbacks in `src/main/index.ts`
- [ ] `yarn checks` passes
- [ ] `yarn test` passes
- [ ] Manual: Electron agent streaming still works

### Phase 1: Fix `telegram-bot-service.ts`

**Problem:** Imports `getSetting` from `@template/main/services/settings-service`.

**Solution:** Accept the default pipeline ID as a constructor parameter.

**Files to change:**

1. **`src/main/services/telegram-bot-service.ts`**
   - Remove: `import { getSetting } from '@template/main/services/settings-service'`
   - Add `defaultPipelineId?: string` to `BotDeps` interface
   - Replace `getSetting('default_pipeline_id', '')` with `this.deps.defaultPipelineId ?? ''`

2. **`src/main/ipc-handlers/telegram-handlers.ts`** (where `TelegramBotService` is constructed)
   - Pass `defaultPipelineId: getSetting('default_pipeline_id', '')` when constructing the deps object

**Checklist:**
- [ ] Remove `getSetting` import from `telegram-bot-service.ts`
- [ ] Add `defaultPipelineId` to `BotDeps` interface
- [ ] Replace `getSetting()` call with `this.deps.defaultPipelineId`
- [ ] Pass `defaultPipelineId` in `telegram-handlers.ts`
- [ ] `yarn checks` passes
- [ ] `yarn test` passes

### Phase 2: Fix `item-service.ts`

**Problem:** Imports `getDatabase()` and `generateId()` from `@template/main/services/database`.

**Solution:** Accept `db` as a parameter and use `crypto.randomUUID()`.

**Files to change:**

1. **`src/main/services/item-service.ts`**
   - Remove: `import { getDatabase, generateId } from '@template/main/services/database'`
   - Add: `import { randomUUID } from 'crypto'`
   - Change every exported function to accept `db: Database.Database` as first parameter
   - Replace `generateId()` with `randomUUID()`

2. **`src/main/ipc-handlers/index.ts`** (or whichever handler file calls item-service)
   - Update all `itemService.*()` calls to pass `services.db` as first argument

**Checklist:**
- [ ] Remove `getDatabase`, `generateId` imports from `item-service.ts`
- [ ] Add `import { randomUUID } from 'crypto'`
- [ ] Add `db` parameter to all exported functions
- [ ] Replace `generateId()` with `randomUUID()`
- [ ] Update callers to pass `services.db`
- [ ] `yarn checks` passes
- [ ] `yarn test` passes

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

**Checklist:**
- [ ] Remove `@template` type import from `migrations.ts`
- [ ] Add local `Migration` interface
- [ ] `yarn checks` passes

### Phase 4: Make `setup.ts` Notification Router Pluggable

**Problem:** `setup.ts` has a dynamic `require('../services/desktop-notification-router')` that creates an architectural boundary violation once the file moves to `src/core/` in PR 2.

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

**Checklist:**
- [ ] Add `notificationRouters` to `AppServicesConfig`
- [ ] Remove dynamic `require()` block from `setup.ts`
- [ ] Use `config?.notificationRouters` in `setup.ts`
- [ ] Pass `DesktopNotificationRouter` from `src/main/index.ts`
- [ ] `yarn checks` passes
- [ ] `yarn test` passes
- [ ] Manual: Desktop notifications still work

### Phase 5: Create SettingsStore in SQLite

**Problem:** Settings currently live in Electron's settings service (`@template/main/services/settings-service`). The daemon has no access to this. All settings access needs to go through a store that lives in the SQLite database.

**Solution:** Create a `settings` table and `SettingsStore` in the business logic layer.

**Files to change:**

1. **`src/main/migrations.ts`**
   - Add migration to create `settings` table:
     ```sql
     CREATE TABLE IF NOT EXISTS settings (
       key TEXT PRIMARY KEY,
       value TEXT NOT NULL
     );
     ```
   - Seed default values for known settings (theme, defaultPipelineId, etc.)

2. **`src/main/stores/settings-store.ts`** (new file)
   - Implement `ISettingsStore` with `get(key)`, `set(key, value)`, `getAll()`, `setMany(updates)`
   - Returns typed `AppSettings` object

3. **`src/main/interfaces/settings-store.ts`** (new file)
   - Define `ISettingsStore` interface

4. **`src/main/providers/setup.ts`**
   - Create `SettingsStore` and add to `AppServices`

5. **`src/main/ipc-handlers/settings-handlers.ts`**
   - Switch from `getSetting`/`setSetting` (Electron) to `services.settingsStore.get`/`set`

**Note:** Existing Electron settings can be migrated on first run by reading them from `getSetting()` and writing to the new store, then switching over. This one-time migration lives in `src/main/index.ts` (Electron entry point only).

**Checklist:**
- [ ] Add `settings` table migration to `migrations.ts`
- [ ] Seed default settings values
- [ ] Create `src/main/stores/settings-store.ts`
- [ ] Create `src/main/interfaces/settings-store.ts`
- [ ] Register `SettingsStore` in `setup.ts` / `AppServices`
- [ ] Switch `settings-handlers.ts` to use `settingsStore`
- [ ] Add one-time Electron→SQLite settings migration in `index.ts`
- [ ] `yarn checks` passes
- [ ] `yarn test` passes
- [ ] Manual: Settings read/write works in Electron

### Phase 6: Document Streaming Path Inventory

**Problem:** PR 3b needs to replace every streaming callback with WebSocket broadcasts. Missing one means a feature silently stops working in daemon mode.

**Solution:** Catalog every streaming path as a reference checklist for PR 3b.

**Deliverable:** Add a section to this document (or a separate file) listing:

| Streaming path | Source file | Callbacks used | WS channel |
|------|------|------|------|
| Agent output/message/status (pipeline hook) | `handlers/agent-handler.ts` | `onOutput`, `onMessage`, `onStatus` | `agent:output`, `agent:message`, `agent:status` |
| Agent output/message/status (IPC start) | `ipc-handlers/agent-handlers.ts` | same pattern via `startAgent()` | same |
| Agent resume (IPC send message) | `ipc-handlers/agent-handlers.ts` | `onOutput`, `onMessage`, `onStatusChange` via `resumeAgent()` | same |
| Chat output/message | `ipc-handlers/chat-session-handlers.ts` | `onEvent` callback with `sendToRenderer` | `chat:output`, `chat:message` |
| Task chat output/message | `ipc-handlers/chat-session-handlers.ts` | same pattern, task-scoped | `task-chat:output`, `task-chat:message` |
| Telegram agent streaming | `ipc-handlers/telegram-handlers.ts` | `botService.onOutput`, `botService.onMessage` | `chat:output`, `chat:message` |
| Interrupted runs broadcast | `ipc-handlers/agent-handlers.ts` | `sendToRenderer` for recovered runs | `agent:interrupted-runs` |

**Checklist:**
- [ ] Streaming inventory table completed with all paths
- [ ] Each path has: source file, callbacks used, target WS channel
- [ ] Verified against actual code (no missing paths)

### PR 1 Verification

```bash
yarn checks   # TypeScript compiles, ESLint passes
yarn test      # All tests pass
# Manual: Electron app starts, agent streaming works
# Manual: CLI works (npx agents-manager tasks list)
# Manual: Settings are read/written from SQLite
```

---

## PR 2: Move Files to `src/core/` + Update All References

**Goal:** Physically move all pure business logic files from `src/main/` to `src/core/`.

### Phase 7: Create `src/core/` and Move Files

| Source | Destination | Count |
|--------|------------|-------|
| `src/main/agents/*` | `src/core/agents/*` | ~5 |
| `src/main/libs/*` | `src/core/libs/*` | ~3 |
| `src/main/data/*` | `src/core/data/*` | ~1 |
| `src/main/handlers/*` | `src/core/handlers/*` | ~7 |
| `src/main/interfaces/*` | `src/core/interfaces/*` | ~26 |
| `src/main/providers/*` | `src/core/providers/*` | ~1 |
| `src/main/services/*` (pure) | `src/core/services/*` | ~24 + timeline/ |
| `src/main/stores/*` | `src/core/stores/*` | ~16 |
| `src/main/migrations.ts` | `src/core/migrations.ts` | 1 |

**Stays in `src/main/`:**
- `index.ts` (Electron entry point)
- `ipc-handlers/` (entire directory — 13 handler files, all correctly Electron-only)
- `services/desktop-notification-router.ts` (Electron-specific)

**Internal imports:** No changes needed within the moved files — relative structure is preserved since entire directories move together.

**Checklist:**
- [ ] Create `src/core/` directory
- [ ] Move `agents/` to `src/core/agents/`
- [ ] Move `libs/` to `src/core/libs/`
- [ ] Move `data/` to `src/core/data/`
- [ ] Move `handlers/` to `src/core/handlers/`
- [ ] Move `interfaces/` to `src/core/interfaces/`
- [ ] Move `providers/` to `src/core/providers/`
- [ ] Move pure `services/` to `src/core/services/`
- [ ] Move `stores/` to `src/core/stores/`
- [ ] Move `migrations.ts` to `src/core/migrations.ts`
- [ ] Verify `src/main/` only contains: `index.ts`, `ipc-handlers/`, `services/desktop-notification-router.ts`

### Phase 8: Update Imports in Non-Moved Files

1. **`src/main/index.ts`** — `./providers/setup` → `../core/providers/setup`, etc.
2. **`src/main/ipc-handlers/*.ts`** — 13 handler files, update imports from `../services/`, `../interfaces/`, `../stores/` to `../../core/services/`, `../../core/interfaces/`, `../../core/stores/`
3. **`src/main/services/desktop-notification-router.ts`** — `../interfaces/` → `../../core/interfaces/`
4. **`src/cli/db.ts`** — `../main/migrations` → `../core/migrations`, etc.
5. **`src/cli/index.ts`** — `../main/providers/setup` → `../core/providers/setup`
6. **`src/cli/context.ts`** — same pattern

**Checklist:**
- [ ] Update `src/main/index.ts` imports
- [ ] Update all 13 `src/main/ipc-handlers/*.ts` files
- [ ] Update `src/main/services/desktop-notification-router.ts`
- [ ] Update `src/cli/db.ts`
- [ ] Update `src/cli/index.ts`
- [ ] Update `src/cli/context.ts`
- [ ] `yarn checks` passes

### Phase 9: Update Test Imports

Global find-and-replace: `../../src/main/` → `../../src/core/`
- Affects **~31 test files**, **~91 import statements**
- `tests/helpers/test-context.ts` is the most affected single file (~44 imports)

**Checklist:**
- [ ] Find-replace `../../src/main/` → `../../src/core/` in all test files
- [ ] Verify `tests/helpers/test-context.ts` (~44 imports updated)
- [ ] `yarn test` passes (all ~59 tests)

### Phase 10: Update Build Configuration

1. **`config/tsconfig.main.json`** — add `"../src/core/**/*"` to include
2. **`config/tsconfig.cli.json`** — add `"../src/core/**/*"`, can remove `"../src/main/**/*"` if CLI no longer imports from main
3. **`tsconfig.json`** — add `"@core/*": ["src/core/*"]` path alias
4. **`vitest.config.ts`** — add `@core` alias

**Checklist:**
- [ ] Update `config/tsconfig.main.json` — add `src/core/**/*`
- [ ] Update `config/tsconfig.cli.json` — add `src/core/**/*`, remove `src/main/**/*`
- [ ] Update `tsconfig.json` — add `@core/*` path alias
- [ ] Update `vitest.config.ts` — add `@core` alias
- [ ] `yarn checks` passes
- [ ] `yarn test` passes

### PR 2 Verification

```bash
yarn checks && yarn test
# Manual: Electron app starts, CLI works
```

**Enforcement:** Add ESLint rule or CI check: no file in `src/core/` may import from `electron`, `@template/*`, or `src/main/`.

---

## PR 3a: Daemon Infrastructure

**Goal:** Create a runnable daemon process with health endpoint, WebSocket skeleton, and CLI management commands. No business routes yet — just the infrastructure.

### Phase 11: Create `src/daemon/` Directory Structure

```
src/daemon/
  index.ts                    # Entry point
  server.ts                   # Express app setup
  routes/                     # (empty for now — populated in PR 3b)
    health.ts                 # Health + shutdown endpoints
  ws/
    ws-server.ts              # WebSocket server + subscription manager
    channels.ts               # Channel definitions
  middleware/
    auth.ts                   # Token-based auth (optional)
    error-handler.ts          # Centralized error handling
  lifecycle.ts                # Startup, shutdown, supervisor management
```

**Checklist:**
- [ ] Create `src/daemon/` directory structure
- [ ] Create `src/daemon/index.ts` (entry point)
- [ ] Create `src/daemon/server.ts` (Express app setup)
- [ ] Create `src/daemon/routes/health.ts`
- [ ] Create `src/daemon/ws/ws-server.ts`
- [ ] Create `src/daemon/ws/channels.ts`
- [ ] Create `src/daemon/middleware/error-handler.ts`
- [ ] Create `src/daemon/lifecycle.ts`

### Phase 12: Shared Database Initialization

Move the DB setup from `src/cli/db.ts` to a shared location usable by daemon, CLI, and tests:

```
src/core/
  db.ts                       # open SQLite, run migrations, enable WAL + foreign keys
```

This is the current `src/cli/db.ts` logic extracted to `src/core/db.ts`. Both the daemon and CLI import from it. The CLI's `db.ts` becomes a thin re-export or is deleted.

**Checklist:**
- [ ] Create `src/core/db.ts` (extracted from `src/cli/db.ts`)
- [ ] Update `src/cli/db.ts` to re-export or delete
- [ ] Update daemon entry point to use `src/core/db.ts`
- [ ] `yarn checks` passes
- [ ] `yarn test` passes

### Phase 13: Express Server + CORS + Health Endpoint

**Server setup:**

```typescript
// src/daemon/server.ts
import express from 'express';
import cors from 'cors';
import { createServer as createHttpServer } from 'http';

export function createServer(services: AppServices) {
  const app = express();
  app.use(cors({ origin: true }));  // Allow all origins (localhost only)
  app.use(express.json());

  // Error handler — catch thrown errors from route handlers
  app.use((err, req, res, next) => {
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message, code: err.code });
  });

  const httpServer = createHttpServer(app);
  return { app, httpServer };
}
```

**Health endpoint:**

```typescript
// src/daemon/routes/health.ts
router.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), version: pkg.version });
});

router.post('/api/shutdown', (req, res) => {
  res.status(204).end();
  process.emit('SIGTERM');
});
```

**Dependencies to install:** `express`, `cors`, `ws`, `@types/express`, `@types/cors`

**Checklist:**
- [ ] Install `express`, `cors`, `ws`, `@types/express`, `@types/cors`
- [ ] Implement `createServer()` in `src/daemon/server.ts`
- [ ] Implement health endpoint (`GET /api/health`)
- [ ] Implement shutdown endpoint (`POST /api/shutdown`)
- [ ] Implement centralized error handler middleware
- [ ] Enable CORS
- [ ] `curl /api/health` returns `{ status: "ok" }`

### Phase 14: WebSocket Server Skeleton

Implement the subscription-based WebSocket server. No channels are actively broadcasting yet — this is the infrastructure that PR 3b will wire up.

```typescript
// src/daemon/ws/ws-server.ts
export class DaemonWsServer {
  private wss: WebSocketServer;
  private subscriptions = new Map<WebSocket, Set<string>>();

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }

  broadcast(channel: string, id: string | undefined, data: unknown): void { ... }

  createStreamingCallbacks(taskId: string) {
    return {
      onOutput: (chunk: string) => this.broadcast('agent:output', taskId, chunk),
      onMessage: (msg: string) => this.broadcast('agent:message', taskId, msg),
      onStatus: (status: string) => this.broadcast('agent:status', taskId, status),
    };
  }

  close(): void { this.wss.close(); }
}
```

**Checklist:**
- [ ] Implement `DaemonWsServer` class
- [ ] Handle client connections and subscription messages
- [ ] Implement `broadcast()` method
- [ ] Implement `createStreamingCallbacks()` method
- [ ] Implement `close()` for graceful shutdown
- [ ] Test with `wscat` — subscribe and receive test broadcast

### Phase 15: Build Pipeline (esbuild)

Add daemon build target:

1. **`config/tsconfig.daemon.json`** — includes `src/daemon/**/*`, `src/core/**/*`, `src/shared/**/*`
2. **`package.json`** — add script:
   ```json
   "build:daemon": "esbuild src/daemon/index.ts --bundle --platform=node --outfile=dist-daemon/index.js --external:better-sqlite3"
   ```
   Note: `better-sqlite3` must be external (native module, can't be bundled).
3. **`.gitignore`** — add `dist-daemon/`

**Checklist:**
- [ ] Create `config/tsconfig.daemon.json`
- [ ] Add `build:daemon` script to `package.json`
- [ ] Add `dist-daemon/` to `.gitignore`
- [ ] `yarn build:daemon` produces `dist-daemon/index.js`
- [ ] `node dist-daemon/index.js` starts daemon successfully

### Phase 16: Daemon CLI Commands

Add daemon management to the existing CLI:

```bash
agents-manager daemon start          # Start in foreground
agents-manager daemon start --detach # Start detached (background)
agents-manager daemon stop           # Stop running daemon
agents-manager daemon status         # Check if daemon is running
```

Implementation:
- Foreground mode: start the daemon server inline (same process)
- Detached mode: spawn `node dist-daemon/index.js` as a detached child process (requires Phase 15 build)
- PID file: write to `~/.agents-manager/daemon.pid`
- Auth token: write random token to `~/.agents-manager/daemon.token`
- Status: check PID file + health endpoint
- Stop: send SIGTERM to PID or call `POST /api/shutdown`

**Checklist:**
- [ ] Implement `daemon start` (foreground mode)
- [ ] Implement `daemon start --detach` (background mode)
- [ ] Implement `daemon stop`
- [ ] Implement `daemon status`
- [ ] PID file written to `~/.agents-manager/daemon.pid`
- [ ] Auth token written to `~/.agents-manager/daemon.token`
- [ ] `agents-manager daemon status` reports correct state

### PR 3a Verification

```bash
yarn checks && yarn test
yarn build:daemon

# Start daemon
node dist-daemon/index.js

# Test health
curl http://localhost:3847/api/health
# → { "status": "ok", "uptime": 1.23, "version": "1.0.0" }

# Test WebSocket (wscat)
wscat -c ws://localhost:3847/ws
> {"type":"subscribe","channel":"agent:output","id":"test"}

# Daemon CLI
agents-manager daemon status
# → Daemon running on port 3847 (PID 12345)
```

---

## PR 3b: Port All Routes + Wire Streaming

**Goal:** Write all daemon REST routes and wire all streaming paths through WebSocket. After this PR, the daemon API is feature-complete.

**Strategy: Write fresh, not refactor.** The daemon routes are new code written from scratch. The existing IPC handlers serve as a **reference** for what each endpoint should do (which service method to call, what inputs to validate, what to return), but the route files are not copy-pasted or mechanically transformed from the IPC handlers. This is cleaner because:
- Express route patterns are structurally different from IPC handler patterns
- We can fix inconsistencies and simplify as we go
- No risk of carrying over Electron-specific assumptions
- Each route file is self-contained and easy to review

### Phase 17: Write CRUD Routes

Write each CRUD route file. Each follows the same pattern — thin handler that validates input, delegates to a core service, returns JSON. Use the corresponding IPC handler as reference for which service methods to call.

| Route file | Endpoints | Source IPC handler |
|------------|-----------|-------------------|
| `routes/projects.ts` | CRUD for `/api/projects` | `project-handlers.ts` |
| `routes/tasks.ts` | CRUD + transitions for `/api/tasks` | `task-handlers.ts` |
| `routes/pipelines.ts` | Read-only `/api/pipelines` | `pipeline-handlers.ts` |
| `routes/features.ts` | CRUD for `/api/features` | `feature-handlers.ts` |
| `routes/kanban.ts` | CRUD for `/api/kanban/boards` | `kanban-handlers.ts` |
| `routes/agent-definitions.ts` | CRUD for `/api/agent-definitions` | `agent-def-handlers.ts` |
| `routes/items.ts` | CRUD for `/api/items` | `index.ts` (legacy) |
| `routes/settings.ts` | GET/PATCH `/api/settings` | `settings-handlers.ts` |
| `routes/dashboard.ts` | GET `/api/dashboard/stats` | `index.ts` |
| `routes/events.ts` | GET `/api/events`, `/api/activities`, `/api/tasks/:id/timeline` | `index.ts` |

**Pattern for each route:**

```typescript
export function taskRoutes(services: AppServices): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const tasks = await services.workflowService.listTasks(req.query);
      res.json(tasks);
    } catch (err) { next(err); }
  });

  // ... etc
  return router;
}
```

**Checklist:**
- [ ] Write `routes/projects.ts`
- [ ] Write `routes/tasks.ts` (CRUD + transitions)
- [ ] Write `routes/pipelines.ts`
- [ ] Write `routes/features.ts`
- [ ] Write `routes/kanban.ts`
- [ ] Write `routes/agent-definitions.ts`
- [ ] Write `routes/items.ts`
- [ ] Write `routes/settings.ts`
- [ ] Write `routes/dashboard.ts`
- [ ] Write `routes/events.ts`
- [ ] Register all routes in `server.ts`
- [ ] `yarn checks` passes

### Phase 18: Write Action Routes

These routes involve side-effects (starting agents, sending messages, git operations) and are more complex than CRUD. Write fresh, using IPC handlers as reference:

| Route file | Endpoints | Source IPC handler |
|------------|-----------|-------------------|
| `routes/agents.ts` | Start/stop/message/runs for `/api/tasks/:id/agent/*` | `agent-handlers.ts` |
| `routes/chat.ts` | Sessions + send/stop for `/api/chat/*` | `chat-session-handlers.ts` |
| `routes/task-chat.ts` | Send/stop/messages for `/api/tasks/:id/chat/*` | `chat-session-handlers.ts` |
| `routes/telegram.ts` | Start/stop/status for `/api/telegram/*` | `telegram-handlers.ts` |
| `routes/git.ts` | Diff/log/status for `/api/tasks/:id/git/*` | `git-handlers.ts` |
| `routes/prompts.ts` | GET/respond for `/api/prompts/*` | `index.ts` |
| `routes/artifacts.ts` | GET for `/api/tasks/:id/artifacts` | `index.ts` |

**Checklist:**
- [ ] Write `routes/agents.ts` (start/stop/message/runs)
- [ ] Write `routes/chat.ts` (sessions + send/stop)
- [ ] Write `routes/task-chat.ts` (send/stop/messages)
- [ ] Write `routes/telegram.ts` (start/stop/status)
- [ ] Write `routes/git.ts` (diff/log/status)
- [ ] Write `routes/prompts.ts` (get/respond)
- [ ] Write `routes/artifacts.ts`
- [ ] Register all routes in `server.ts`
- [ ] `yarn checks` passes

### Phase 19: Wire All Streaming Paths to WebSocket

Using the inventory from Phase 6, wire each streaming path to WS broadcasts:

1. **Agent streaming (pipeline hook):**
   Already wired — `createAppServices` receives `createStreamingCallbacks` from the WS server (done in PR 3a's Phase 14).

2. **Agent streaming (REST start/resume):**
   ```typescript
   // routes/agents.ts
   router.post('/:id/agent/start', async (req, res, next) => {
     const taskId = req.params.id;
     const run = await services.workflowService.startAgent(
       taskId, req.body.mode, req.body.agentType,
       (chunk) => wsServer.broadcast('agent:output', taskId, chunk),
       (msg) => wsServer.broadcast('agent:message', taskId, msg),
       (status) => wsServer.broadcast('agent:status', taskId, status),
     );
     res.json(run);
   });
   ```

3. **Chat streaming:**
   ```typescript
   // routes/chat.ts
   router.post('/sessions/:id/send', async (req, res, next) => {
     const sessionId = req.params.id;
     const result = await services.chatAgentService.send(sessionId, req.body.message, {
       onEvent: (event) => {
         if (event.type === 'text') wsServer.broadcast('chat:output', sessionId, event.text);
         else if (event.type === 'message') wsServer.broadcast('chat:message', sessionId, event.message);
       },
     });
     res.json(result);
   });
   ```

4. **Task chat streaming:** Same pattern as chat, using `task-chat:output` and `task-chat:message` channels.

5. **Telegram bot streaming:**
   Wire in daemon lifecycle (not in route handler):
   ```typescript
   // src/daemon/lifecycle.ts
   function wireTelegramStreaming(botService: TelegramAgentBotService, wsServer: DaemonWsServer) {
     botService.onOutput = (sessionId, chunk) => wsServer.broadcast('chat:output', sessionId, chunk);
     botService.onMessage = (sessionId, msg) => wsServer.broadcast('chat:message', sessionId, msg);
   }
   ```

6. **Interrupted runs:**
   ```typescript
   // During daemon startup recovery
   const interrupted = await services.agentService.recoverOrphanedRuns();
   if (interrupted.length > 0) {
     wsServer.broadcast('agent:interrupted-runs', undefined, interrupted);
   }
   ```

**Checklist:**
- [ ] Agent streaming (pipeline hook) → WS broadcast wired
- [ ] Agent streaming (REST start/resume) → WS broadcast wired
- [ ] Chat streaming → WS broadcast wired
- [ ] Task chat streaming → WS broadcast wired
- [ ] Telegram bot streaming → wired in `lifecycle.ts`
- [ ] Interrupted runs broadcast → wired in daemon startup
- [ ] All Phase 6 inventory items verified as covered

### Phase 20: End-to-End Daemon Testing

Verify every endpoint works by testing against the running daemon:

```bash
yarn build:daemon && node dist-daemon/index.js &

# CRUD
curl http://localhost:3847/api/projects
curl -X POST http://localhost:3847/api/tasks -d '{"projectId":"...","pipelineId":"...","title":"Test"}'

# Transitions
curl -X POST http://localhost:3847/api/tasks/$TASK_ID/transition -d '{"toStatus":"in_progress"}'

# Agent start + WS streaming
wscat -c ws://localhost:3847/ws
> {"type":"subscribe","channel":"agent:*","id":"$TASK_ID"}
# In another terminal:
curl -X POST http://localhost:3847/api/tasks/$TASK_ID/agent/start -d '{"mode":"implement"}'

# Settings
curl http://localhost:3847/api/settings
curl -X PATCH http://localhost:3847/api/settings -d '{"theme":"dark"}'
```

**Checklist:**
- [ ] All CRUD endpoints return correct data
- [ ] Task transitions work via REST
- [ ] Agent start triggers WS streaming events
- [ ] Chat send triggers WS streaming events
- [ ] Settings GET/PATCH work
- [ ] Dashboard stats endpoint works
- [ ] Telegram bot endpoints work
- [ ] Git endpoints work

### PR 3b Verification

```bash
yarn checks && yarn test
yarn build:daemon

# Full manual test of all endpoint groups
# Existing Electron app still works (still uses IPC directly at this point)
```

---

## PR 4: Convert UIs to Thin Clients

**Goal:** All UIs connect to the daemon instead of importing core services directly.

**Strategy: Rewrite the thin clients, don't refactor.** The CLI and Electron IPC handlers are replaced with fresh code that uses the API client. The old handler files are deleted, not surgically updated. This is simpler and less error-prone than modifying 13 handler files in-place — the new handlers are one-liners, so writing them fresh is faster than diffing against the old ones.

### Phase 21: Create Shared Client SDK

```
src/client/
  api-client.ts               # Typed REST client
  ws-client.ts                # WebSocket subscription client
  index.ts                    # Exports
```

The client SDK provides typed methods for every REST endpoint:

```typescript
export function createApiClient(baseUrl: string, token?: string): ApiClient {
  return {
    health: () => get('/api/health'),
    tasks: {
      list: (filter?) => get('/api/tasks', filter),
      get: (id) => get(`/api/tasks/${id}`),
      create: (input) => post('/api/tasks', input),
      transition: (id, toStatus, actor?) => post(`/api/tasks/${id}/transition`, { toStatus, actor }),
      // ... etc
    },
    agents: {
      start: (taskId, mode, agentType?) => post(`/api/tasks/${taskId}/agent/start`, { mode, agentType }),
      stop: (runId) => post(`/api/agent/runs/${runId}/stop`),
      // ... etc
    },
    // ... etc for all endpoint groups
  };
}
```

The WebSocket client handles subscription management and auto-reconnection:

```typescript
export function createWsClient(url: string, opts?: { reconnect?: boolean }): WsClient {
  // Auto-reconnect on disconnect
  // Re-send subscriptions after reconnect
  // Return unsubscribe functions
}
```

**Checklist:**
- [ ] Create `src/client/api-client.ts` with typed methods for all endpoints
- [ ] Create `src/client/ws-client.ts` with subscribe/unsubscribe + auto-reconnect
- [ ] Create `src/client/index.ts` (exports)
- [ ] `yarn checks` passes

### Phase 22: Rewrite CLI as Thin Client

Write a new CLI from scratch that uses the API client. The old `src/cli/` code (which imports `src/core/` directly) is deleted and replaced.

```typescript
// src/cli/index.ts (new)
const daemonUrl = await ensureDaemon(); // Auto-start if not running
const api = createApiClient(daemonUrl);
const ws = createWsClient(daemonUrl.replace('http', 'ws') + '/ws');

registerTaskCommands(program, api);
registerAgentCommands(program, api, ws);
// ... etc
```

**Auto-start logic:**
1. Check `GET http://localhost:3847/api/health`
2. If daemon is running → use it
3. If not → spawn daemon as detached child, wait for health check, then proceed

The new CLI imports only from `src/client/` and `src/shared/` — never from `src/core/`.

**What gets deleted:** `src/cli/db.ts` (DB initialization — now in `src/core/db.ts`), `src/cli/context.ts` (direct service access), and any direct `src/core/` imports in `src/cli/index.ts`.

**Checklist:**
- [ ] Implement `ensureDaemon()` auto-start logic
- [ ] Rewrite `src/cli/index.ts` to use `createApiClient`
- [ ] Write command registration functions (tasks, agents, etc.)
- [ ] Delete old `src/cli/db.ts`
- [ ] Delete old `src/cli/context.ts`
- [ ] Remove all `src/core/` imports from `src/cli/`
- [ ] `agents-manager tasks list` works via daemon
- [ ] `agents-manager daemon start` + CLI commands work end-to-end

### Phase 23: Rewrite Electron IPC Handlers as API Client Wrappers

Delete the 13 old IPC handler files in `src/main/ipc-handlers/` and write new ones from scratch. The new handlers are trivial one-liners that delegate to the API client:

```typescript
// src/main/ipc-handlers/task-handlers.ts (new — entire file is ~20 lines)
export function registerTaskHandlers(api: ApiClient) {
  registerIpcHandler(IPC_CHANNELS.TASK_LIST, async (_, filter) => api.tasks.list(filter));
  registerIpcHandler(IPC_CHANNELS.TASK_GET, async (_, id) => api.tasks.get(id));
  registerIpcHandler(IPC_CHANNELS.TASK_CREATE, async (_, input) => api.tasks.create(input));
  registerIpcHandler(IPC_CHANNELS.TASK_UPDATE, async (_, id, input) => api.tasks.update(id, input));
  registerIpcHandler(IPC_CHANNELS.TASK_DELETE, async (_, id) => api.tasks.delete(id));
  registerIpcHandler(IPC_CHANNELS.TASK_TRANSITION, async (_, id, toStatus, actor) => api.tasks.transition(id, toStatus, actor));
  // ... etc
}
```

Forward WebSocket events to the renderer (in `src/main/index.ts`):

```typescript
ws.subscribeGlobal('agent:output', (taskId, chunk) =>
  sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, chunk));
ws.subscribeGlobal('agent:message', (taskId, msg) =>
  sendToRenderer(IPC_CHANNELS.AGENT_MESSAGE, taskId, msg));
ws.subscribeGlobal('agent:status', (taskId, status) =>
  sendToRenderer(IPC_CHANNELS.AGENT_STATUS, taskId, status));
// ... etc for all streaming channels
```

**What the renderer sees:** No change. It still calls `window.api.listTasks()`, `window.api.startAgent()`, etc. The preload bridge and IPC channel names stay identical. Only the handler implementations change (from 13 complex files to 13 trivial files).

**What gets deleted:** The old `src/main/ipc-handlers/` files with direct `services.*` calls, `sendToRenderer` streaming callbacks, and `@template` imports. The new files only import from `src/client/` and `@template/main/ipc/ipc-registry`.

**Checklist:**
- [ ] Delete old 13 IPC handler files
- [ ] Write new `task-handlers.ts` (API client one-liners)
- [ ] Write new `agent-handlers.ts` (API client one-liners)
- [ ] Write new `chat-session-handlers.ts`
- [ ] Write new `pipeline-handlers.ts`
- [ ] Write new `project-handlers.ts`
- [ ] Write new `feature-handlers.ts`
- [ ] Write new `kanban-handlers.ts`
- [ ] Write new `agent-def-handlers.ts`
- [ ] Write new `git-handlers.ts`
- [ ] Write new `settings-handlers.ts`
- [ ] Write new `telegram-handlers.ts`
- [ ] Write new `shell-handlers.ts` (stays Electron-native)
- [ ] Write new `index.ts` (handler registration)
- [ ] Wire WS→renderer forwarding in `src/main/index.ts`
- [ ] Remove all `src/core/` imports from `src/main/ipc-handlers/`
- [ ] `yarn checks` passes
- [ ] Manual: Electron app works with all features via daemon

### Phase 24: Auto-Start Daemon from Electron

When the Electron app starts:

```typescript
// src/main/daemon-launcher.ts
async function ensureDaemon(): Promise<{ url: string; token: string }> {
  const url = `http://localhost:${port}`;
  const tokenPath = path.join(os.homedir(), '.agents-manager', 'daemon.token');

  try {
    await fetch(`${url}/api/health`);
    const token = fs.readFileSync(tokenPath, 'utf-8').trim();
    return { url, token };
  } catch {
    const daemonBin = path.join(__dirname, '../../dist-daemon/index.js');
    const child = spawn(process.execPath, [daemonBin], { detached: true, stdio: 'ignore' });
    child.unref();

    await waitForHealth(url, { timeout: 10000, interval: 200 });
    const token = fs.readFileSync(tokenPath, 'utf-8').trim();
    return { url, token };
  }
}
```

**Important:** The Electron app must NOT open the SQLite database. The daemon is the sole database owner.

**Checklist:**
- [ ] Create `src/main/daemon-launcher.ts`
- [ ] Implement `ensureDaemon()` with health check + spawn fallback
- [ ] Wire daemon launcher in `src/main/index.ts` (before IPC handler registration)
- [ ] Remove DB initialization from Electron entry point
- [ ] Pass API client + WS client to IPC handler registration
- [ ] `yarn checks` passes
- [ ] Manual: Electron starts, auto-launches daemon, all features work

### Phase 25: Enforce Architectural Boundary

After conversion, verify clean separation:

- `src/main/` imports only from: `src/client/`, `src/shared/`, `electron`, `@template/*`
- `src/main/` does NOT import from: `src/core/`
- `src/cli/` imports only from: `src/client/`, `src/shared/`
- `src/cli/` does NOT import from: `src/core/`

Add ESLint rule or CI check to enforce this permanently.

**Checklist:**
- [ ] Verify `src/main/` has zero `src/core/` imports
- [ ] Verify `src/cli/` has zero `src/core/` imports
- [ ] Add ESLint rule or CI check to enforce boundary
- [ ] `yarn checks` passes
- [ ] `yarn test` passes

### PR 4 Verification

```bash
yarn checks && yarn test

# Full flow:
# 1. Start daemon
agents-manager daemon start -d

# 2. Start Electron app (auto-detects daemon)
yarn start

# 3. Use CLI
agents-manager tasks list --project <id>

# 4. Cross-client: start agent from CLI, see output in Electron
# 5. Resilience: close Electron, agent keeps running, reopen — agent is still running
```

---

## Final Architecture After All PRs

```
src/
  core/                          # Pure business logic (zero deps on UI/Electron)
    agents/                      # Agent implementations
    libs/                        # Agent execution engines (ClaudeCode, Cursor, Codex)
    data/                        # Seeded pipelines
    db.ts                        # Shared DB initialization
    handlers/                    # Pipeline hooks
    interfaces/                  # All contracts
    migrations.ts                # DB migrations
    providers/setup.ts           # Composition root
    services/                    # All services
    stores/                      # All SQLite stores (including settings-store)

  daemon/                        # Daemon server (imports core/)
    index.ts                     # Entry point
    server.ts                    # Express + CORS setup
    routes/                      # REST handlers (thin — delegate to core)
    ws/                          # WebSocket server + subscriptions
    middleware/                  # Auth, error handling
    lifecycle.ts                 # Startup/shutdown

  client/                        # Shared API client SDK
    api-client.ts                # Typed REST client
    ws-client.ts                 # WebSocket subscription client

  main/                          # Electron (thin client — imports client/, NOT core/)
    index.ts                     # Bootstrap, ensure daemon, connect
    ipc-handlers/                # IPC → API client delegation (13 files)
    services/                    # Electron-only (desktop notifications)

  cli/                           # CLI (thin client — imports client/, NOT core/)
    index.ts                     # Entry point + auto-start daemon
    commands/                    # CLI commands → API client

  shared/                        # Shared types (used by all layers)
  renderer/                      # React UI (unchanged — uses window.api)
  preload/                       # Electron preload bridge
```

---

## Testing Strategy

**Existing tests are a safety net throughout the refactor.** All 59 tests (24 unit, 33 e2e, 1 integration, 1 CLI) run in pure Node.js with zero Electron dependencies. They use `TestContext` which creates the full service stack with an in-memory SQLite database.

| PR | Test impact | Action needed |
|----|------------|---------------|
| **PR 1** | All tests pass as-is | None — injectable deps have backward-compatible defaults |
| **PR 2** | ~91 import paths break | Mechanical find-replace `../../src/main/` → `../../src/core/` (Phase 9) |
| **PR 3a** | All tests pass as-is | Optionally add daemon health/WS tests |
| **PR 3b** | All tests pass as-is | Write route-level integration tests (supertest against Express) |
| **PR 4** | 2 CLI tests may need updating | CLI tests switch from direct service calls to API client calls |

**TDD approach:** Moderate value for PR 3b (daemon routes are new code, test-first with supertest is natural). Low value for PRs 1-2 (mechanical refactoring — existing tests are the right safety net). Skip for PR 4 (thin wrappers, manual testing is more practical).

**Run `yarn test` after every phase** to catch regressions immediately.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Broken imports after file moves (PR 2) | Low | High | `yarn checks` after every phase |
| Tests fail due to path changes (PR 2) | Low | Medium | Mechanical find-replace, run tests after each batch |
| Daemon port conflicts | Low | Low | Configurable port, PID file lock |
| WebSocket message ordering | Medium | Medium | Each stream is per-task/session; ordering within a stream is guaranteed by WS |
| Daemon crash loses agent state | Medium | High | Agent runs are in SQLite; daemon restart recovers via `recoverOrphanedRuns()` |
| Performance overhead of HTTP vs IPC | Low | Low | Local HTTP is <1ms overhead; streaming uses WS |
| Electron auto-start race condition | Medium | Low | Health check with retry + backoff |
| Missed streaming path in daemon | Medium | Medium | Streaming inventory (Phase 6) used as checklist in Phase 19 |
| SQLite concurrent writers | High | High | Daemon is sole DB owner; Electron and CLI never open DB directly (enforced in Phase 25) |
| Daemon down while Electron running | Medium | Medium | Future: add connection-lost UX to Electron; for now, Electron shows fetch errors |

## Dependency Graph

```
PR 1 ──→ PR 2 ──→ PR 3a ──→ PR 3b ──→ PR 4
                              │
                              └──→ (Web UI can be built anytime after PR 3b)
```

After PR 3b, a web UI can be built independently since the daemon API is available. PR 4 (converting existing UIs to thin clients) can happen in parallel with web UI development.
