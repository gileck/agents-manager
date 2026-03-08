---
title: Architecture Overview
description: System architecture, composition root, and the single-execution-engine principle
summary: "Three-tier daemon architecture: daemon (src/core/ services + SQLite), Electron (thin IPC\u2192API client shell), CLI (thin Commander\u2192API client shell). All business logic lives in src/core/services/ (WorkflowService). The daemon is the sole DB owner."
priority: 1
key_points:
  - "NEVER add business logic to the renderer, CLI, or IPC handlers \u2014 all logic goes in WorkflowService (src/core/services/)"
  - "src/ is application code; template/ is framework infrastructure (DO NOT MODIFY)"
  - "Daemon (src/daemon/) is the sole DB owner; Electron and CLI connect via HTTP/WS API client (src/client/)"
---
# Architecture Overview

System architecture, composition root, and the single-execution-engine principle.

## System Overview

Agents Manager is a three-tier application for managing AI agent workflows. A long-running **daemon process** owns all business logic and the database, while **Electron** and a **CLI** act as thin client shells that communicate with the daemon via HTTP/WebSocket.

- **Daemon process** (`src/daemon/`) — owns the SQLite database, runs all services (WorkflowService, AgentService, etc.), exposes a REST API (Express) and a WebSocket server for push events
- **Electron main process** (`src/main/`) — thin shell: auto-starts the daemon via `ensureDaemon()`, creates an API client from `src/client/`, registers IPC handlers that delegate to the API client, forwards WebSocket events to the renderer
- **CLI (`am`)** (`src/cli/`) — thin shell: auto-starts the daemon via `ensureDaemon()`, creates an API client, Commander commands delegate to the API client
- **React renderer** (`src/renderer/`) — UI-only dashboard (communicates via IPC to Electron main, which forwards to daemon)
- **SQLite** (better-sqlite3) — single-file persistence with WAL mode, owned exclusively by the daemon

```
┌─────────────────────────────────────────────────────────┐
│  Daemon Process (src/daemon/)                           │
│  ┌────────────────────────────────────────────────┐     │
│  │  WorkflowService + all services (src/core/)    │     │
│  │  SQLite DB (sole owner)                        │     │
│  └────────────────────────────────────────────────┘     │
│  REST API (Express)  ←──┐     WebSocket Server          │
└──────────────────────────┼──────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │ API Client       │ API Client       │
        │ (src/client/)    │ (src/client/)    │
┌───────┴────────┐  ┌─────┴──────────────────┐
│  Electron Main │  │  CLI (am)              │
│  src/main/     │  │  src/cli/              │
│  IPC → API     │  │  Commander → API       │
│  WS → Renderer │  │  Thin shell            │
└───────┬────────┘  └────────────────────────┘
        │ IPC
┌───────┴────────┐
│  Renderer      │
│  src/renderer/ │
│  React UI      │
└────────────────┘
```

## Composition Root: `createAppServices(db)`

**File:** `src/core/providers/setup.ts`

The composition root is a single function that wires all dependencies. It returns an `AppServices` object consumed **only by the daemon process** — neither Electron nor CLI call it directly.

```typescript
export interface AppServices {
  db: Database.Database;
  // Phase 1: Core domain
  projectStore: IProjectStore;
  pipelineStore: IPipelineStore;
  taskStore: ITaskStore;
  taskEventLog: ITaskEventLog;
  activityLog: IActivityLog;
  pipelineEngine: IPipelineEngine;
  // Phase 2: Agent execution
  agentRunStore: IAgentRunStore;
  taskArtifactStore: ITaskArtifactStore;
  taskPhaseStore: ITaskPhaseStore;
  pendingPromptStore: IPendingPromptStore;
  agentFramework: IAgentFramework;
  notificationRouter: MultiChannelNotificationRouter;
  agentService: IAgentService;
  workflowService: IWorkflowService;
  pipelineInspectionService: IPipelineInspectionService;
  taskContextStore: ITaskContextStore;
  featureStore: IFeatureStore;
  agentDefinitionStore: IAgentDefinitionStore;
  kanbanBoardStore: IKanbanBoardStore;
  settingsStore: ISettingsStore;
  createWorktreeManager: (path: string) => IWorktreeManager;
  createGitOps: (cwd: string) => IGitOps;
  agentSupervisor: AgentSupervisor;
  timelineService: TimelineService;
  workflowReviewSupervisor: WorkflowReviewSupervisor;
  chatMessageStore: IChatMessageStore;
  chatSessionStore: IChatSessionStore;
  chatAgentService: ChatAgentService;
  agentLibRegistry: AgentLibRegistry;
}
```

### Two-Phase Initialization

**Phase 1 — Core infrastructure (stores + pipeline engine):**

1. Create store instances (project, pipeline, task, event log, activity log)
2. Create `PipelineEngine` with stores and database
3. Register built-in guards via `registerCoreGuards(pipelineEngine, db)`

**Phase 2 — Domain services (agents + workflow):**

1. Create agent-related stores (runs, artifacts, phases, prompts, context, features, definitions)
2. Create factory functions for project-scoped instances
3. Create `AgentLibRegistry`, register engine libs (`ClaudeCodeLib`, `CursorAgentLib`, `CodexCliLib`)
4. Instantiate `AgentFrameworkImpl`, register `Agent` instances with prompt builders (`PlannerPromptBuilder`, `DesignerPromptBuilder`, `ImplementorPromptBuilder`, `InvestigatorPromptBuilder`, `ReviewerPromptBuilder`, `TaskWorkflowReviewerPromptBuilder`) and the `AgentLibRegistry`
5. Create `MultiChannelNotificationRouter` (empty by default; callers inject initial routers via config)
6. Create `AgentService` and `WorkflowService`
7. Register hook handlers (agent, notification, prompt, SCM) — must happen after `WorkflowService` creation

## Interface-First Design

The `src/core/interfaces/` directory defines every service boundary. Key interfaces:

| Interface | File | Key Methods |
|-----------|------|-------------|
| `IProjectStore` | `project-store.ts` | `getProject`, `listProjects`, `createProject`, `updateProject`, `deleteProject` |
| `IPipelineStore` | `pipeline-store.ts` | `getPipeline`, `listPipelines`, `getPipelineForTaskType` |
| `ITaskStore` | `task-store.ts` | `getTask`, `listTasks`, `createTask`, `updateTask`, `deleteTask`, `resetTask`, `addDependency`, `removeDependency` |
| `ITaskEventLog` | `task-event-log.ts` | `log`, `getEvents` |
| `IActivityLog` | `activity-log.ts` | `log`, `getEntries` |
| `IPipelineEngine` | `pipeline-engine.ts` | `getValidTransitions`, `executeTransition`, `registerGuard`, `registerHook` |
| `IAgentFramework` | `agent-framework.ts` | `getAgent`, `listAgents`, `getAvailableAgents`, `registerAgent` |
| `IAgent` | `agent.ts` | `execute`, `stop`, `isAvailable` |
| `IAgentService` | `agent-service.ts` | `execute`, `waitForCompletion`, `stop`, `recoverOrphanedRuns` |
| `IAgentRunStore` | `agent-run-store.ts` | `createRun`, `updateRun`, `getRun`, `getRunsForTask`, `getActiveRuns` |
| `ITaskArtifactStore` | `task-artifact-store.ts` | `createArtifact`, `getArtifactsForTask`, `deleteArtifactsForTask` |
| `ITaskPhaseStore` | `task-phase-store.ts` | `createPhase`, `updatePhase`, `getPhasesForTask`, `getActivePhase` |
| `IPendingPromptStore` | `pending-prompt-store.ts` | `createPrompt`, `answerPrompt`, `getPrompt`, `getPendingForTask`, `expirePromptsForRun` |
| `IWorktreeManager` | `worktree-manager.ts` | `create`, `get`, `list`, `lock`, `unlock`, `delete`, `cleanup` |
| `IGitOps` | `git-ops.ts` | `createBranch`, `checkout`, `fetch`, `push`, `pull`, `diff`, `commit`, `rebase`, `rebaseAbort`, `getCurrentBranch`, `clean`, `status` |
| `IScmPlatform` | `scm-platform.ts` | `createPR`, `mergePR`, `getPRStatus` |
| `INotificationRouter` | `notification-router.ts` | `send` |
| `IWorkflowService` | `workflow-service.ts` | `createTask`, `updateTask`, `deleteTask`, `resetTask`, `transitionTask`, `forceTransitionTask`, `startAgent`, `resumeAgent`, `stopAgent`, `respondToPrompt`, `mergePR`, `getDashboardStats` |
| `IPipelineInspectionService` | `pipeline-inspection-service.ts` | `getPipelineDiagnostics`, `retryHook`, `advancePhase` |
| `ITaskContextStore` | `task-context-store.ts` | `addEntry`, `getEntriesForTask` |
| `IFeatureStore` | `feature-store.ts` | `getFeature`, `listFeatures`, `createFeature`, `updateFeature`, `deleteFeature` |
| `IAgentDefinitionStore` | `agent-definition-store.ts` | `getDefinition`, `listDefinitions`, `getDefinitionByAgentType`, `getDefinitionByMode` |

Most interfaces are re-exported from `src/core/interfaces/index.ts`.

## Handler Registration Pattern

### Guards

Guards are registered on the `PipelineEngine` and run **synchronously** inside a SQLite transaction before a status update. They can block a transition.

```typescript
engine.registerGuard('guard_name', (task, transition, context, db, params?) => {
  return { allowed: boolean, reason?: string };
});
```

Built-in guards are registered via `registerCoreGuards(engine, db)` in `src/core/handlers/core-guards.ts`. See [pipeline-engine.md](./pipeline-engine.md) for the full list.

### Hooks

Hooks run **asynchronously** after the transaction commits. Behavior on failure depends on the hook's execution policy: `required` hooks roll back the transition on failure, `best_effort` hooks log a warning, and `fire_and_forget` hooks are not awaited. See [pipeline-engine.md](./pipeline-engine.md) for details.

```typescript
engine.registerHook('hook_name', async (task, transition, context) => {
  // side-effect: start agent, create PR, send notification, etc.
});
```

**Registration order in `setup.ts` (matters for hook ordering):**

1. `registerAgentHandler` — hook `start_agent`
2. `registerNotificationHandler` — hook `notify`
3. `registerPromptHandler` — hook `create_prompt`
4. `registerScmHandler` — hooks `merge_pr`, `push_and_create_pr`

| Hook Name | Handler File | Purpose |
|-----------|-------------|---------|
| `start_agent` | `src/core/handlers/agent-handler.ts` | Fire-and-forget agent execution |
| `notify` | `src/core/handlers/notification-handler.ts` | Notifications (templated) |
| `create_prompt` | `src/core/handlers/prompt-handler.ts` | Create pending prompt for human input |
| `merge_pr` | `src/core/handlers/scm-handler.ts` | Merge PR via GitHub CLI |
| `push_and_create_pr` | `src/core/handlers/scm-handler.ts` | Rebase, push, create PR |
| `advance_phase` | `src/core/handlers/phase-handler.ts` | Advance to next implementation phase |

## Entry Points

### Daemon (`src/daemon/index.ts`)

The daemon is the sole process that owns the database and runs all services:

```typescript
// Opens DB (path resolved internally), creates all services with streaming callbacks
const db = openDatabase();
const services = createAppServices(db, { createStreamingCallbacks });
const { httpServer } = createServer(services, wsHolder);
const wsServer = new DaemonWsServer(httpServer);
startSupervisors(services);
httpServer.listen(PORT, '127.0.0.1');
```

**Logging:** All daemon logging goes through `getAppLogger()` from `src/core/services/app-logger.ts` — there are no raw `console.*` calls. Before the DB is initialized, the app logger falls back to `console.*` which is captured to `~/.agents-manager/daemon.log`. Global `uncaughtException` and `unhandledRejection` handlers are registered at the top of the daemon entry point to ensure fatal errors are always recorded.

### Electron Main Process (`src/main/index.ts`)

The Electron main process is a thin shell that delegates all operations to the daemon:

```typescript
// Auto-start daemon if not already running
const { url: daemonUrl, wsUrl: daemonWsUrl } = await ensureDaemon();
// Create API client pointing to daemon HTTP
const api = createApiClient(daemonUrl);
// Register IPC handlers that delegate to API client
registerIpcHandlers(api);
// Create WS client to forward daemon events to renderer
const wsClient = createWsClient(daemonWsUrl, { reconnect: true });
// Forward each WS channel individually
wsClient.subscribeGlobal('agent:output', (taskId, data) =>
  sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, data));
// ... (one subscribeGlobal per push event channel)
```

IPC handlers in `src/main/ipc-handlers/` expose API client methods to the renderer via IPC channels (see [ipc-and-renderer.md](./ipc-and-renderer.md)).

### CLI (`src/cli/index.ts`)

The CLI is a thin Commander.js shell that delegates all operations to the daemon:

```typescript
// Auto-start daemon if not already running (src/cli/ensure-daemon.ts)
const daemonUrl = await ensureDaemon();
// Create API client pointing to daemon HTTP
const api = createApiClient(daemonUrl);
// Commander commands call api methods
```

Note: The CLI's `ensureDaemon()` (from `src/cli/ensure-daemon.ts`) returns a URL string, while Electron's `ensureDaemon()` (from `src/main/daemon-launcher.ts`) returns `{ url, wsUrl }` since Electron also needs the WebSocket URL.

See [cli-reference.md](./cli-reference.md) for the full CLI reference.

## Stub vs Real Implementations

### NotificationRouter

The notification subsystem uses a composite router pattern. `MultiChannelNotificationRouter` wraps multiple `INotificationRouter` implementations and dispatches notifications to all channels in parallel via `Promise.allSettled`.

At startup, the composition root creates an empty `MultiChannelNotificationRouter`. Callers can inject initial routers via `config.notificationRouters` (tests inject a `StubNotificationRouter`). When a Telegram bot is started for a project, a `TelegramNotificationRouter` is dynamically added to the composite router.

```typescript
// Composite router starts empty in production
const multiRouter = new MultiChannelNotificationRouter();
// Later, when Telegram bot starts:
multiRouter.addRouter(telegramRouter);
```

| Implementation | File | Behavior |
|---------------|------|----------|
| `MultiChannelNotificationRouter` | `src/core/services/multi-channel-notification-router.ts` | Composite router dispatching to all registered channels via `Promise.allSettled` |
| `TelegramNotificationRouter` | `src/core/services/telegram-notification-router.ts` | Sends MarkdownV2-formatted messages to a Telegram chat |
| `StubNotificationRouter` | `src/core/services/stub-notification-router.ts` | Collects notifications in-memory for testing |

### Git Operations

`LocalGitOps` and `GitHubScmPlatform` have corresponding stub variants for testing:

| Implementation | File | Behavior |
|---------------|------|----------|
| `LocalGitOps` | `src/core/services/local-git-ops.ts` | Shells out to `git` CLI |
| `StubGitOps` | `src/core/services/stub-git-ops.ts` | In-memory no-op for testing |
| `GitHubScmPlatform` | `src/core/services/github-scm-platform.ts` | Shells out to `gh` CLI |

The real implementations use resolved shell environment from `src/core/services/shell-env.ts`.

## Factory Functions

Factory functions create **project-scoped instances** on demand, rather than pre-instantiated singletons:

```typescript
const createGitOps = (cwd: string) => new LocalGitOps(cwd);
const createWorktreeManager = (path: string) => new LocalWorktreeManager(path);
const createScmPlatform = (path: string) => new GitHubScmPlatform(path);
```

These are passed to `AgentService`, `WorkflowService`, and SCM handler as constructor dependencies, allowing each service to create instances scoped to a specific project's filesystem path.

## Edge Cases

- The daemon is the sole DB owner — Electron and CLI never open the database directly.
- Electron auto-starts the daemon via `ensureDaemon()` if not already running.
- Factory functions create **new instances per call**, not singletons. Each agent run gets its own `GitOps` and `WorktreeManager` scoped to the project path.
