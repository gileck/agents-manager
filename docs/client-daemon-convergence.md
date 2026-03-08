---
title: Client-Daemon Convergence
description: How all UI clients (Electron, CLI, Web, Telegram bot) converge on the same daemon logic
summary: "Every UI action — whether from Electron, CLI, Web UI, or Telegram bot — ends up calling the same WorkflowService methods in the daemon process. This guarantees identical behavior: pipeline guards, hooks, agent execution, notifications, and event logging all run the same way regardless of the originating client."
priority: 2
key_points:
  - "All clients converge on the same daemon WorkflowService — transitions, task CRUD, agent starts all go through one code path"
  - "Telegram bot runs inside the daemon process with direct service references (zero network hops)"
  - "Electron and CLI are thin HTTP clients — they call daemon REST endpoints that delegate to the same services"
  - "Pipeline hooks (start_agent, notify, push_and_create_pr) fire identically regardless of which client triggered the transition"
  - "Daemon singleton enforced by health check probe + OS TCP port bind on fixed port 3847"
---
# Client-Daemon Convergence

How all UI clients converge on the same daemon logic, guaranteeing identical behavior.

## The Core Principle

Every operation — whether initiated from the Electron app, CLI, Telegram bot, or a future web client — ends up calling the **same service methods in the same daemon process**. There is no separate code path per client. Pipeline guards, hooks, agent execution, notifications, and event logging all run identically regardless of where the action originated.

This is the central architectural guarantee of the daemon model.

## How Each Client Reaches the Daemon

All clients end up calling the **same method on the same `WorkflowService` instance** in the daemon process. The only difference is how many transport hops it takes to get there.

### Electron App (IPC → HTTP → Daemon)

```
Renderer: window.api.tasks.transition(taskId, status)
  → IPC handler (src/main/ipc-handlers/task-handlers.ts)
    → api.tasks.transition(taskId, status, actor)   // HTTP POST
      → Daemon route: POST /api/tasks/:id/transition
        → services.workflowService.transitionTask(...)  ←── THE SAME OBJECT
```

### CLI (HTTP → Daemon)

```
$ npx agents-manager tasks transition <id> <status>
  → api.tasks.transition(id, status, actor)   // HTTP POST
    → Daemon route: POST /api/tasks/:id/transition
      → services.workflowService.transitionTask(...)  ←── THE SAME OBJECT
```

### Telegram Bot (Already Inside the Daemon)

The Telegram bot runs **inside the daemon process**. It is instantiated in the daemon's Telegram route handler (`src/daemon/routes/telegram.ts`) and receives a direct reference to the daemon's `workflowService` — the same object that the HTTP routes use. There is no network hop.

```
Telegram inline button: t|<taskId>|<status>
  → TelegramAgentBotService.handleTransition()
    → this.deps.workflowService.transitionTask(...)  ←── THE SAME OBJECT
```

`this.deps.workflowService` **is** `services.workflowService`. It was passed by reference when the bot was constructed:

```typescript
// src/daemon/routes/telegram.ts — bot gets the daemon's own services
const botService = new TelegramAgentBotService({
  workflowService: services.workflowService,   // ← same object the routes use
  ...
});
```

So from `transitionTask()` onward, Telegram, Electron, and CLI execute **identical code** — same guards, same hooks, same agent execution.

### Web UI (HTTP + WebSocket → Daemon)

The web client uses the API shim (`src/web/api-shim.ts`) which wraps the same `ApiClient` from `src/client/api-client.ts`. Push events use a browser-native WebSocket connected to the daemon's WS server. See `docs/web-ui.md` for full details.

```
Browser: window.api.tasks.transition(taskId, status)
  → api-shim → ApiClient.tasks.transition(...)   // HTTP POST
    → Daemon route: POST /api/tasks/:id/transition
      → services.workflowService.transitionTask(...)  ←── THE SAME OBJECT
```

## Convergence Diagram

```
┌─────────────┐  ┌──────────┐  ┌───────────────┐
│  Electron   │  │   CLI    │  │   Web UI      │
│  Renderer   │  │ (am CLI) │  │  (Browser)    │
└──────┬──────┘  └────┬─────┘  └──────┬────────┘
       │ IPC          │               │
┌──────┴──────┐       │               │
│  Electron   │       │               │
│  Main (IPC  │       │               │
│  handlers)  │       │               │
└──────┬──────┘       │               │
       │ HTTP         │ HTTP          │ HTTP
       └──────────────┼───────────────┘
                      │
┌─────────────────────┼──────────────────────────────┐
│  Daemon Process     │                              │
│                     ▼                              │
│          REST API (Express routes)                 │
│                     │                              │
│  Telegram Bot ──────┤  (direct call, same object)  │
│  (lives in daemon)  │                              │
│                     ▼                              │
│  ╔══════════════════════════════════════════════╗   │
│  ║  workflowService.transitionTask(...)        ║   │
│  ║  ← ALL CLIENTS CONVERGE HERE               ║   │
│  ║                                             ║   │
│  ║  → PipelineEngine (guards + hooks)          ║   │
│  ║  → AgentService   (agent execution)         ║   │
│  ║  → SQLite DB      (sole owner)              ║   │
│  ╚══════════════════════════════════════════════╝   │
└────────────────────────────────────────────────────┘
```

## Example: Task Transition That Starts an Agent

This is the most important example because it demonstrates the old architecture's failure mode: in the old design, transitioning from Telegram (which used a separate CLI process) would update the DB but the pipeline hooks would run in that separate process — not in the Electron process where agents actually ran. Agents would never start.

In the new architecture, all paths converge:

### What Happens When a User Transitions "open → implementing"

Regardless of which client triggers it, the flow is:

**Step 1 — `WorkflowService.transitionTask()`** (`src/core/services/workflow-service.ts:214`)

```typescript
const result = await this.pipelineEngine.executeTransition(task, toStatus, {
  trigger: 'manual',
  actor,   // 'telegram', 'cli', or undefined (Electron)
});
```

All three clients end up calling this identical method on the same `WorkflowService` instance in the daemon. The `trigger` is always `'manual'` — only `AgentService` can trigger `'agent'` transitions.

**Step 2 — `PipelineEngine.executeTransition()`** (`src/core/services/pipeline-engine.ts:110`)

1. Looks up the pipeline transition definition (e.g., `open → implementing` with `trigger: 'manual'`)
2. Runs guards inside a SQLite transaction — if any guard blocks, the transition fails
3. Atomically updates the task status in the database
4. After the transaction commits, runs `executeHooks()` on all configured hooks

**Step 3 — `start_agent` hook fires** (`src/core/handlers/agent-handler.ts:20`)

The `open → implementing` transition in `AGENT_PIPELINE` has a `start_agent` hook configured with `mode: 'implement'` and `agentType: 'implementor'`. The hook:

1. Reads `mode` and `agentType` from hook params
2. Gets streaming callbacks from the daemon's WebSocket server (`wsServer.createStreamingCallbacks(taskId)`)
3. Calls `workflowService.startAgent()` in fire-and-forget mode — the hook returns `{ success: true }` immediately
4. `startAgent()` calls `agentService.execute()`, which creates a worktree, launches the agent, and streams output via WebSocket to all connected clients

**The agent runs in the daemon process.** All connected clients (Electron, Telegram, CLI) can observe its output via WebSocket.

### Per-Client: What Differs vs What's Identical

**What differs** — only how the call reaches the daemon:

| | Electron | CLI | Telegram Bot |
|-|----------|-----|-------------|
| Transport to daemon | IPC + HTTP POST | HTTP POST | None (already in daemon) |
| `actor` value | From renderer (often `undefined`) | `--actor` flag value | `'telegram'` |
| Output delivery | WS → Electron wsClient → IPC → renderer | WS (if subscribed) | WS broadcast |

**What's identical** — from `transitionTask()` onward, it's the same code path on the same object:

- Same `WorkflowService.transitionTask()` method
- Same `PipelineEngine.executeTransition()` — same guards, same transaction
- Same `executeHooks()` — same `start_agent` hook fires
- Same `AgentService.execute()` — agent runs in the daemon process

## Example: Task Creation

Task creation also converges identically:

**Electron:** `window.api.tasks.create(input)` → IPC → `api.tasks.create(input)` → `POST /api/tasks` → `services.workflowService.createTask(input)`

**CLI:** `npx agents-manager tasks create --title "..."` → `api.tasks.create(input)` → `POST /api/tasks` → `services.workflowService.createTask(input)`

**Telegram:** `/create` → user types title → `this.deps.workflowService.createTask({ projectId, pipelineId, title })` (direct call)

All three end up calling `WorkflowService.createTask()` which validates the input, creates the task in SQLite, logs the activity, and returns the new task.

## Example: Task Deletion

**Electron:** `window.api.tasks.delete(id)` → IPC → HTTP DELETE → `services.workflowService.deleteTask(id)`

**CLI:** `npx agents-manager tasks delete <id>` → HTTP DELETE → `services.workflowService.deleteTask(id)`

**Telegram:** "Confirm Delete" button → `this.deps.workflowService.deleteTask(taskId)` (direct call)

All paths clean up dependencies, worktrees, and related data identically because the same `WorkflowService.deleteTask()` method handles it.

## Why the Telegram Bot Lives Inside the Daemon

The Telegram bot lives inside the daemon process so it is available even without Electron running. On daemon startup, `autoStartTelegramBots()` automatically starts bots for all projects with valid telegram config (where `autoStart !== false`). Users can also manually start/stop bots via the UI (`POST /api/telegram/start`). The daemon's route handler creates a `TelegramAgentBotService` and passes it the daemon's own service references:

```typescript
// src/daemon/routes/telegram.ts:54-63
const botService = new TelegramAgentBotService({
  taskStore: services.taskStore,
  projectStore: services.projectStore,
  pipelineStore: services.pipelineStore,
  pipelineEngine: services.pipelineEngine,
  workflowService: services.workflowService,
  chatSessionStore: services.chatSessionStore,
  chatAgentService: services.chatAgentService,
  defaultPipelineId: services.settingsStore.get('default_pipeline_id', ''),
});
```

`this.deps.workflowService` inside the bot is the **same object** as `services.workflowService` used by daemon routes. This is why a Telegram transition triggers the exact same pipeline hooks and agent execution as an Electron transition — there is literally one `WorkflowService` instance, one `PipelineEngine`, one `AgentService`, all in one process.

## Daemon Singleton Guarantee

All clients converge on a single daemon process. This is what makes the convergence work — there is exactly one `WorkflowService`, one `PipelineEngine`, one `AgentService`, and one SQLite database, all in one process.

### How It Works

Both Electron and CLI call `ensureDaemon()` before any operation. The flow:

1. **Probe** — `GET http://127.0.0.1:3847/api/health` (3-second timeout)
2. **If 200** — daemon is already running, reuse it
3. **If ECONNREFUSED** — no daemon running, spawn one as a detached background process with stdout/stderr redirected to `~/.agents-manager/daemon.log`
4. **Poll until healthy** — up to 15 seconds (CLI) or 10 seconds (Electron)

The port is **fixed** at `3847` (overridable via `AM_DAEMON_PORT` env var). All clients use the same port, so they always talk to the same daemon.

```
┌────────────┐   ┌────────────┐
│  Electron  │   │    CLI     │
│  startup   │   │  startup   │
└─────┬──────┘   └─────┬──────┘
      │                 │
      ▼                 ▼
  ensureDaemon()    ensureDaemon()
      │                 │
      ▼                 ▼
  GET :3847/health  GET :3847/health
      │                 │
      ├── 200? ─────────┤── 200?
      │   reuse         │   reuse
      │                 │
      ├── fail? ────────┤── fail?
      │   spawn daemon  │   spawn daemon
      │   wait healthy  │   wait healthy
      ▼                 ▼
  ┌──────────────────────────┐
  │  Single Daemon Process   │
  │  port 3847               │
  └──────────────────────────┘
```

### Hard Guard: TCP Port Bind

If two callers race past the health check simultaneously (both see "not running" and both spawn), the OS TCP `bind()` on port 3847 is the hard singleton guard:

- **First daemon** to call `httpServer.listen(3847)` succeeds and starts serving
- **Second daemon** gets `EADDRINUSE` from the OS and exits with code 1
- **Both callers** poll `waitForHealth()` and find the surviving daemon healthy

The system self-heals: one daemon wins, the other dies, all clients connect to the winner.

### What Enforces Singleton (and What Doesn't)

| Mechanism | Present? | Notes |
|-----------|----------|-------|
| Health check probe | Yes | Soft gate — prevents spawning if daemon already up |
| OS TCP port bind | Yes | Hard gate — `EADDRINUSE` kills the second daemon |
| Lock file (`flock`) | No | No filesystem lock |
| PID file | Advisory only | Written after spawn; used by `daemon stop` to find the process, but not read by `ensureDaemon()` |
| Log file | Diagnostic | `~/.agents-manager/daemon.log` — captures stdout/stderr from the detached daemon process |

### PID File

The PID file at `~/.agents-manager/daemon.pid` is written after spawning and read only by the `daemon stop` / `daemon status` commands. `ensureDaemon()` ignores it entirely — it relies purely on the health check.

### Log File

Both launchers redirect the daemon's stdout/stderr to `~/.agents-manager/daemon.log` (append mode). The daemon itself has no raw `console.*` calls — all logging goes through `getAppLogger()`, which writes to SQLite during normal operation. Before the DB is initialized, the app logger's fallback writes to `console.*`, which is captured by this log file. This ensures that fatal startup crashes and unhandled exceptions are always recorded even when the DB is unavailable.

### Key Files

| File | Singleton Role |
|------|---------------|
| `src/cli/ensure-daemon.ts` | CLI auto-start: health probe → spawn → waitForHealth |
| `src/main/daemon-launcher.ts` | Electron auto-start: same pattern, 10s timeout |
| `src/daemon/index.ts` | Daemon entry point: `httpServer.listen(PORT)` — EADDRINUSE kills duplicates |
| `src/cli/commands/daemon.ts` | Explicit `daemon start/stop/status`, PID file read/write |
| `~/.agents-manager/daemon.log` | Daemon stdout/stderr log file (append mode) |

## Key Files

| File | Role in Convergence |
|------|-------------------|
| `src/core/services/workflow-service.ts` | The convergence point — all clients call its methods |
| `src/core/services/pipeline-engine.ts` | Executes guards + hooks identically for all callers |
| `src/core/handlers/agent-handler.ts` | `start_agent` hook — fires agent execution in the daemon |
| `src/daemon/routes/tasks.ts` | HTTP endpoint that Electron and CLI call for transitions |
| `src/daemon/routes/telegram.ts` | Instantiates bot inside daemon with direct service refs |
| `src/core/services/telegram-agent-bot-service.ts` | Bot calls `workflowService` directly (no HTTP) |
| `src/main/ipc-handlers/task-handlers.ts` | Electron IPC → HTTP delegation |
| `src/client/api-client.ts` | Typed HTTP client shared by Electron and CLI |

## Adding a New Client

To add a new UI client:

1. Use the existing `createApiClient(daemonUrl)` from `src/client/api-client.ts`, or call the daemon REST API directly
2. For push events, connect to the daemon WebSocket (`ws://127.0.0.1:{port}/ws`)
3. No service code changes needed — the daemon already exposes everything
4. See `src/web/api-shim.ts` as a reference implementation

The client is display + input only. All business logic, validation, guards, hooks, agent execution, and event logging happen in the daemon.
