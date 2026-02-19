# Architecture Overview

System architecture, composition root, and the single-execution-engine principle.

## System Overview

Agents Manager is an Electron + React + CLI + SQLite application for managing AI agent workflows. It provides:

- **Electron main process** — all business logic, services, and data access
- **React renderer** — UI-only dashboard (communicates via IPC)
- **CLI (`am`)** — terminal interface that shares the same services and database
- **SQLite** (better-sqlite3) — single-file persistence with WAL mode for concurrency

All three entry points instantiate the same `AppServices` object via `createAppServices(db)` from `src/main/providers/setup.ts`.

```
┌─────────────────────────────────────────────────┐
│  WorkflowService (the engine)                   │
│  src/main/services/                             │
│                                                 │
│  ALL features go here. All UIs consume this.    │
└──────────────┬──────────────────┬───────────────┘
               │ IPC              │ createAppServices(db)
┌──────────────┴─────┐  ┌────────┴────────────────┐
│  Electron Renderer │  │  CLI (am)                │
│  src/renderer/     │  │  src/cli/                │
│  React UI          │  │  Terminal UI             │
│  UI ONLY           │  │  UI ONLY                 │
└────────────────────┘  └─────────────────────────┘
```

## Composition Root: `createAppServices(db)`

**File:** `src/main/providers/setup.ts`

The composition root is a single function that wires all dependencies. It returns an `AppServices` object consumed by both entry points.

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
  notificationRouter: INotificationRouter;
  agentService: IAgentService;
  workflowService: IWorkflowService;
  taskContextStore: ITaskContextStore;
  featureStore: IFeatureStore;
  agentDefinitionStore: IAgentDefinitionStore;
  createWorktreeManager: (path: string) => IWorktreeManager;
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
3. Instantiate `AgentFrameworkImpl`, register `ClaudeCodeAgent`, `PrReviewerAgent`, `ScriptedAgent`
4. Load `NotificationRouter` (real or stub, see below)
5. Create `AgentService` and `WorkflowService`
6. Register hook handlers (agent, notification, prompt, SCM) — must happen after `WorkflowService` creation

## Interface-First Design

The `src/main/interfaces/` directory contains 21 interface files defining every service boundary:

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
| `IWorkflowService` | `workflow-service.ts` | `createTask`, `updateTask`, `deleteTask`, `resetTask`, `transitionTask`, `startAgent`, `stopAgent`, `respondToPrompt`, `mergePR`, `getDashboardStats` |
| `ITaskContextStore` | `task-context-store.ts` | `addEntry`, `getEntriesForTask` |
| `IFeatureStore` | `feature-store.ts` | `getFeature`, `listFeatures`, `createFeature`, `updateFeature`, `deleteFeature` |
| `IAgentDefinitionStore` | `agent-definition-store.ts` | `getDefinition`, `listDefinitions`, `getDefinitionByAgentType`, `getDefinitionByMode` |

Most interfaces are re-exported from `src/main/interfaces/index.ts`.

## Handler Registration Pattern

### Guards

Guards are registered on the `PipelineEngine` and run **synchronously** inside a SQLite transaction before a status update. They can block a transition.

```typescript
engine.registerGuard('guard_name', (task, transition, context, db, params?) => {
  return { allowed: boolean, reason?: string };
});
```

Built-in guards are registered via `registerCoreGuards(engine, db)` in `src/main/handlers/core-guards.ts`. See [pipeline-engine.md](./pipeline-engine.md) for the full list.

### Hooks

Hooks run **asynchronously** after the transaction commits. A hook failure does not roll back the transition — it is logged as a warning.

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
| `start_agent` | `src/main/handlers/agent-handler.ts` | Fire-and-forget agent execution |
| `notify` | `src/main/handlers/notification-handler.ts` | Desktop notifications (templated) |
| `create_prompt` | `src/main/handlers/prompt-handler.ts` | Create pending prompt for human input |
| `merge_pr` | `src/main/handlers/scm-handler.ts` | Merge PR via GitHub CLI |
| `push_and_create_pr` | `src/main/handlers/scm-handler.ts` | Rebase, push, create PR |

## Entry Points

### Electron Main Process (`src/main/index.ts`)

```typescript
initDatabase({ filename: 'agents-manager.db', migrations: getMigrations() });
const db = getDatabase();
services = createAppServices(db);
registerIpcHandlers(services);
```

IPC handlers in `src/main/ipc-handlers.ts` expose `AppServices` methods to the renderer via 57+ IPC channels (see [ipc-and-renderer.md](./ipc-and-renderer.md)).

### CLI (`src/cli/index.ts`)

```typescript
function getServices(): AppServices {
  if (!_services) {
    const result = openDatabase(opts.db); // src/cli/db.ts
    _services = result.services;
  }
  return _services;
}
```

`openDatabase()` (in `src/cli/db.ts`) opens the same SQLite file, enables WAL + foreign keys, runs migrations, and calls `createAppServices(db)`. See [cli-reference.md](./cli-reference.md) for the full CLI reference.

## Stub vs Real Implementations

### NotificationRouter

The desktop notification router depends on Electron APIs not available in the CLI. Selection uses a dynamic `require()` with try/catch:

```typescript
let notificationRouter: INotificationRouter;
try {
  const { DesktopNotificationRouter } = require('../services/desktop-notification-router');
  notificationRouter = new DesktopNotificationRouter();
} catch {
  notificationRouter = new StubNotificationRouter();
}
```

| Implementation | File | Behavior |
|---------------|------|----------|
| `DesktopNotificationRouter` | `src/main/services/desktop-notification-router.ts` | macOS native notifications, opens task on click |
| `StubNotificationRouter` | `src/main/services/stub-notification-router.ts` | Collects notifications in-memory (no-op) |

### Git Operations

`LocalGitOps` and `GitHubScmPlatform` have corresponding stub variants for testing:

| Implementation | File | Behavior |
|---------------|------|----------|
| `LocalGitOps` | `src/main/services/local-git-ops.ts` | Shells out to `git` CLI |
| `StubGitOps` | `src/main/services/stub-git-ops.ts` | In-memory no-op for testing |
| `GitHubScmPlatform` | `src/main/services/github-scm-platform.ts` | Shells out to `gh` CLI |

The real implementations use resolved shell environment from `src/main/services/shell-env.ts`.

## Factory Functions

Factory functions create **project-scoped instances** on demand, rather than pre-instantiated singletons:

```typescript
const createGitOps = (cwd: string) => new LocalGitOps(cwd);
const createWorktreeManager = (path: string) => new LocalWorktreeManager(path);
const createScmPlatform = (path: string) => new GitHubScmPlatform(path);
```

These are passed to `AgentService`, `WorkflowService`, and SCM handler as constructor dependencies, allowing each service to create instances scoped to a specific project's filesystem path.

## Edge Cases

- **DesktopNotificationRouter** is loaded via `require()` with try/catch — it fails silently in CLI environments and falls back to the stub.
- Factory functions create **new instances per call**, not singletons. Each agent run gets its own `GitOps` and `WorktreeManager` scoped to the project path.
- Both Electron and CLI can access the database concurrently thanks to SQLite WAL mode.
- The CLI lazy-opens the database on first command execution — not at program startup.
