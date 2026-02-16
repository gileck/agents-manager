# Architecture: Abstraction Layers

## Principles

### 1. Interface-First
Every external dependency and swappable concern is accessed through an interface. The application code (UI, IPC handlers, business logic) never depends on a specific implementation directly. This means any layer can be replaced without refactoring the rest of the system.

### 2. Async Everywhere (HARD REQUIREMENT)
**Every public interface method returns a `Promise`.** This is a non-negotiable architectural constraint, not a suggestion. No synchronous return types on any interface, even if the current implementation (SQLite) is synchronous under the hood.

**Why this is critical:** Any layer may move to the cloud in the future (MongoDB, remote DB, remote agent service, cloud storage, external task manager). If we use sync interfaces now, migrating to async later means refactoring every caller across the entire codebase. By enforcing async interfaces from day one, swapping SQLite for MongoDB is a single-file change in the composition root.

```typescript
// WRONG - assumes local sync access, locks us into sync forever
interface ITaskStore {
  getTask(id: string): Task | null;
  listTasks(projectId: string): Task[];
}

// RIGHT - always async, works with local SQLite AND remote APIs
interface ITaskStore {
  getTask(id: string): Promise<Task | null>;
  listTasks(projectId: string): Promise<Task[]>;
}
```

This applies to ALL public interfaces between domains: stores, engine, git ops, notifications — everything. The SQLite implementations simply mark methods as `async` (the sync return values are auto-wrapped in resolved Promises). The cost is negligible, but the future flexibility is enormous.

#### Async Interfaces vs Sync Implementation Internals

The "async everywhere" rule applies to **public interfaces** — the contracts between application domains. It does NOT mean every internal implementation detail must be async. Specifically:

- **Public interface methods** → MUST return `Promise<T>`
- **SQLite store implementations** → methods are `async` (wrapping sync better-sqlite3 calls)
- **Transaction internals** → MAY use sync raw SQL (better-sqlite3's `db.transaction()` requires a synchronous callback)

This distinction matters most in the Pipeline Engine, which needs atomic transactions:

```typescript
// The public interface is async
interface IPipelineEngine {
  executeTransition(task: Task, toStatus: string, ctx?: TransitionContext): Promise<TransitionResult>;
}

// The SQLite implementation: async public method, sync transaction internals
class PipelineEngine implements IPipelineEngine {
  async executeTransition(task, toStatus, ctx): Promise<TransitionResult> {
    // 1. Fetch pipeline via async store (BEFORE transaction)
    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);

    // 2. Sync transaction — uses raw SQL, NOT async store methods
    //    (better-sqlite3 transactions require synchronous callbacks)
    const txn = this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
      // ... run guards (sync), update status (raw SQL), insert history (raw SQL)
    });
    txn();

    // 3. After transaction — use async stores again
    await this.taskEventLog.log({ ... });
    return { success: true, task: updatedTask };
  }
}
```

**Key rule:** A MongoDB implementation of the same interface would use MongoDB transactions (which are async) instead of better-sqlite3 transactions. The public interface stays identical — callers never know or care which database is underneath.

```
┌─────────────────────────────────────────────────────────────┐
│                        UI (React)                            │
│         Pages, Components, Hooks                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ IPC
┌──────────────────────▼──────────────────────────────────────┐
│                   IPC Handlers                               │
│         Thin layer - calls services                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                 Business Logic                                │
│   Orchestrates across providers, applies rules               │
│   e.g., "start agent" = update task status + spawn agent     │
└──────┬────────┬────────┬────────┬────────┬────────┬─────────┘
       │        │        │        │        │        │
   ┌───▼──┐ ┌──▼───┐ ┌──▼──┐ ┌──▼───┐ ┌──▼──┐ ┌──▼────┐
   │Task  │ │Agent │ │Git  │ │SCM   │ │Notif│ │Storage│
   │Store │ │Frame │ │Ops  │ │Platf │ │ier  │ │       │
   └───┬──┘ └──┬───┘ └──┬──┘ └──┬───┘ └──┬──┘ └──┬────┘
       │        │        │        │        │        │
   ┌───▼──┐ ┌──▼───┐ ┌──▼──┐ ┌──▼───┐ ┌──▼──┐ ┌──▼────┐
   │SQLite│ │Claude│ │Local│ │GitHub│ │Electr│ │SQLite │
   │      │ │Code  │ │ Git │ │      │ │on    │ │       │
   └──────┘ └──────┘ └─────┘ └──────┘ └─────┘ └───────┘
```

The middle row (Task Store, Agent Framework, etc.) are **interfaces**. The bottom row are **implementations**. Swapping means writing a new bottom-row box and registering it.

---

## Dependency Injection (Constructor Injection)

All dependencies are injected through constructors. No service locator, no global registry, no magic strings. Every class declares exactly what it needs — TypeScript enforces it at compile time.

### Why Constructor Injection (Not a Registry)

| | Service Locator (Registry) | Constructor Injection |
|---|---|---|
| Dependencies | Hidden — resolved at runtime from global | Explicit — declared in constructor signature |
| Type safety | Runtime errors if key missing | Compile-time errors if dep missing |
| Testability | Need to set up global registry or mock it | Pass mocks directly to constructor |
| Refactoring | Rename a key → runtime crash | Rename a type → compiler catches all usages |
| Readability | Must search code for `registry.get()` calls | Read the constructor to see all deps |

### Composition Root (`setup.ts`)

The **composition root** is the single place where implementations are imported and wired together. This is the ONLY file that knows about concrete classes.

```typescript
// src/main/providers/setup.ts
// Called once at app startup. This is the ONLY place implementations are imported.

import { SqliteTaskStore } from '../implementations/sqlite-task-store';
import { SqliteProjectStore } from '../implementations/sqlite-project-store';
import { ClaudeCodeAgent } from '../implementations/claude-code-agent';
import { LocalGitOps } from '../implementations/local-git-ops';
import { LocalWorktreeManager } from '../implementations/local-worktree-manager';
import { GitHubPlatform } from '../implementations/github-platform';
import { DesktopNotificationChannel } from '../implementations/desktop-notification';
import { NotificationRouterImpl } from '../implementations/notification-router';
import { SqliteActivityLog } from '../implementations/sqlite-activity-log';
import { SqliteStorage } from '../implementations/sqlite-storage';
import { SqlitePipelineStore } from '../implementations/sqlite-pipeline-store';
import { SqliteTaskEventLog } from '../implementations/sqlite-task-event-log';
import { PipelineEngineImpl } from '../implementations/pipeline-engine';
import { WorkflowServiceImpl } from '../implementations/workflow-service';
import { OUTCOME_SCHEMAS } from '../handlers/outcome-schemas';

// The full dependency graph, built once at startup
export function createAppServices(db: Database): AppServices {
  // Layer 1: Data stores (no dependencies beyond db)
  const taskStore = new SqliteTaskStore(db);
  const projectStore = new SqliteProjectStore(db);
  const pipelineStore = new SqlitePipelineStore(db);
  const eventLog = new SqliteTaskEventLog(db);
  const activityLog = new SqliteActivityLog(db);
  const storage = new SqliteStorage(db);

  // Layer 2: Infrastructure (may depend on stores)
  const gitOps = new LocalGitOps();
  const worktreeManager = new LocalWorktreeManager();
  const scmPlatform = new GitHubPlatform();
  const desktopChannel = new DesktopNotificationChannel();
  const notificationRouter = new NotificationRouterImpl();
  notificationRouter.register(desktopChannel);
  const agentFramework = new ClaudeCodeAgent();

  // Layer 3: Pipeline handlers (feature modules - guards + hooks organized by concern)
  const coreHandler = new CoreHandler(taskStore, agentFramework);
  const agentHandler = new AgentHandler(agentFramework, worktreeManager);
  const gitHandler = new GitHandler(gitOps, taskStore);
  const prReviewHandler = new PrReviewHandler(taskStore, scmPlatform, agentFramework);
  const notificationHandler = new NotificationHandler(notificationRouter);
  const activityHandler = new ActivityHandler(activityLog);
  const payloadHandler = new PayloadHandler(taskStore, eventLog);

  // Layer 4: Engine (depends on stores + handlers + outcome schemas)
  const pipelineEngine = new PipelineEngineImpl(
    taskStore, pipelineStore, eventLog,
    [coreHandler, agentHandler, gitHandler, prReviewHandler,
     notificationHandler, activityHandler, payloadHandler],
    OUTCOME_SCHEMAS  // outcome→payload schema mapping for validation
  );

  // Layer 5: Orchestration (depends on everything)
  const workflowService = new WorkflowServiceImpl(
    taskStore, projectStore, pipelineEngine, pipelineStore,
    eventLog, activityLog, agentFramework, gitOps,
    worktreeManager, scmPlatform, notificationRouter, storage
  );

  return {
    taskStore, projectStore, pipelineStore, eventLog,
    activityLog, storage, gitOps, worktreeManager,
    scmPlatform, notificationRouter, agentFramework,
    pipelineEngine, workflowService,
  };
}

// Type-safe container — no magic strings, no `any`
interface AppServices {
  taskStore: ITaskStore;
  projectStore: IProjectStore;
  pipelineStore: IPipelineStore;
  eventLog: ITaskEventLog;
  activityLog: IActivityLog;
  storage: IStorage;
  gitOps: IGitOps;
  worktreeManager: IWorktreeManager;
  scmPlatform: IScmPlatform;
  notificationRouter: INotificationRouter;
  agentFramework: IAgentFramework;
  pipelineEngine: IPipelineEngine;
  workflowService: IWorkflowService;
}
```

### How Services Declare Dependencies

Every service takes its dependencies as constructor parameters:

```typescript
// src/main/implementations/workflow-service.ts
export class WorkflowServiceImpl implements IWorkflowService {
  constructor(
    private taskStore: ITaskStore,
    private projectStore: IProjectStore,
    private pipelineEngine: IPipelineEngine,
    private pipelineStore: IPipelineStore,
    private eventLog: ITaskEventLog,
    private activityLog: IActivityLog,
    private agentFramework: IAgentFramework,
    private gitOps: IGitOps,
    private worktreeManager: IWorktreeManager,
    private scmPlatform: IScmPlatform,
    private notificationRouter: INotificationRouter,
    private storage: IStorage,
  ) {}

  async createTask(input: CreateTaskInput): Promise<Task> {
    // All deps available via this.taskStore, this.eventLog, etc.
    const task = await this.taskStore.createTask(input);
    await this.eventLog.log({ ... });
    return task;
  }
}
```

### How IPC Handlers Get Services

IPC handlers receive the `AppServices` object and destructure what they need:

```typescript
// src/main/ipc-handlers.ts
export function registerIpcHandlers(services: AppServices) {
  const { workflowService } = services;

  ipcMain.handle('task:create', async (_, input) => {
    return workflowService.createTask(input);
  });

  ipcMain.handle('task:list', async (_, projectId, filters) => {
    return workflowService.listTasks(projectId, filters);
  });

  // ... all handlers are thin wrappers around workflowService
}
```

### App Initialization

```typescript
// src/main/index.ts
import { createAppServices } from './providers/setup';

const db = initDatabase({ filename: 'agents-manager.db' });
const services = createAppServices(db);
registerIpcHandlers(services);
```

### Testing

Constructor injection makes testing trivial — pass mocks directly:

```typescript
// In tests
const mockTaskStore = { createTask: vi.fn(), listTasks: vi.fn(), ... };
const mockEventLog = { log: vi.fn(), list: vi.fn(), ... };

const service = new WorkflowServiceImpl(
  mockTaskStore,
  mockProjectStore,
  mockPipelineEngine,
  // ... only mock what the test needs
);

await service.createTask({ title: 'Test' });
expect(mockTaskStore.createTask).toHaveBeenCalledWith({ title: 'Test' });
```

No global state to set up or tear down. Each test creates its own instance with exactly the mocks it needs.

---

## Interface Definitions

### 1. Task Store (`ITaskStore`)

Manages task CRUD. Phase 1: SQLite. Future: Linear, Jira, GitHub Projects, Notion.

```typescript
// src/main/interfaces/task-store.ts

interface ITaskStore {
  // Tasks
  listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]>;
  getTask(id: string): Promise<Task | null>;
  createTask(data: CreateTaskInput): Promise<Task>;
  updateTask(id: string, data: UpdateTaskInput): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  reorderTask(id: string, status: TaskStatus, sortOrder: number): Promise<void>;

  // Dependencies
  addDependency(taskId: string, dependsOnTaskId: string): Promise<void>;
  removeDependency(taskId: string, dependsOnTaskId: string): Promise<void>;
  getDependencies(taskId: string): Promise<Task[]>;
  getDependents(taskId: string): Promise<Task[]>;

  // Subtasks
  getSubtasks(parentTaskId: string): Promise<Task[]>;

  // Bulk
  bulkUpdateStatus(taskIds: string[], status: TaskStatus): Promise<void>;
  bulkDelete(taskIds: string[]): Promise<void>;

  // Notes
  listNotes(taskId: string): Promise<TaskNote[]>;
  addNote(taskId: string, content: string, author: string): Promise<TaskNote>;
  deleteNote(noteId: string): Promise<void>;
}

interface TaskFilters {
  status?: TaskStatus[];
  priority?: TaskPriority[];
  size?: TaskSize[];
  complexity?: TaskComplexity[];
  tags?: string[];
  search?: string;
  parentTaskId?: string | null; // null = top-level only
}

interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  size?: TaskSize;
  complexity?: TaskComplexity;
  tags?: string[];
  parentTaskId?: string;
}

interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  size?: TaskSize;
  complexity?: TaskComplexity;
  tags?: string[];
  plan?: string;
  sortOrder?: number;
}
```

**Phase 1 implementation:** `SqliteTaskStore` - reads/writes to local SQLite
**Future:** `LinearTaskStore` - calls Linear API, maps Linear issues to Task interface

---

### 2. Project Store (`IProjectStore`)

Manages project CRUD. Phase 1: SQLite. Future: could read from a config file, or sync with a remote service.

```typescript
// src/main/interfaces/project-store.ts

interface IProjectStore {
  list(): Promise<Project[]>;
  getById(id: string): Promise<Project | null>;
  getByPath(path: string): Promise<Project | null>;
  create(data: CreateProjectInput): Promise<Project>;
  update(id: string, data: UpdateProjectInput): Promise<Project>;
  delete(id: string): Promise<void>;
}

interface CreateProjectInput {
  name: string;
  path: string;
  description?: string;
}

interface UpdateProjectInput {
  name?: string;
  description?: string;
}
```

---

### 3. Agent Framework (`IAgentFramework`)

Runs AI coding agents. Phase 1: Claude Code SDK. Future: Cursor, Aider, Codex, custom.

```typescript
// src/main/interfaces/agent-framework.ts

interface IAgentFramework {
  // Registry of available agent types
  getAvailableAgents(): Promise<AgentTypeInfo[]>;
  getAgent(agentType: string): IAgent;
}

interface IAgent {
  readonly type: string;
  readonly displayName: string;

  // Check if this agent is installed and usable
  isAvailable(): Promise<boolean>;

  // Get the default config for this agent type
  getDefaultConfig(): AgentConfig;

  // Run the agent
  run(options: AgentRunOptions): Promise<AgentRunResult>;

  // Stop a running agent (by run ID)
  stop(runId: string): void;
}

interface AgentTypeInfo {
  type: string;
  displayName: string;
  available: boolean;
  description: string;
}

interface AgentRunOptions {
  runId: string;
  projectPath: string;
  prompt: string;
  config: AgentConfig;
  env: Record<string, string>;
  onMessage: (message: AgentMessage) => void;
  abortSignal: AbortSignal;
}

interface AgentRunResult {
  transcript: AgentMessage[];
  tokenUsage?: TokenUsage;
  exitCode: number;
  outcome?: string;              // named outcome: "pr_ready", "plan_complete", "needs_info", etc. (only when exitCode === 0)
  payload?: TransitionPayload;   // structured output parsed by adapter (needs_info, options, etc.)
  error?: string;                // error message when exitCode !== 0
}

interface AgentConfig {
  model?: string;
  maxTurns?: number;
  timeout?: number;
  temperature?: number;
  systemPrompt?: string;
  allowedTools?: string[];
  branchPrefix?: string;
  // Agent-specific config lives here too
  [key: string]: any;
}

interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  toolUse?: { name: string; input: any; output: any }[];
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
}
```

**Phase 1:** Single `ClaudeCodeAgent` implementing `IAgent`
**Phase 3:** `AgentFrameworkImpl` implementing `IAgentFramework` with a registry of multiple `IAgent` implementations

---

### 4. Git Operations (`IGitOps`)

Abstracts git commands. Phase 1: local git CLI via child_process. Future: could use libgit2, or a remote git service.

```typescript
// src/main/interfaces/git-ops.ts

interface IGitOps {
  // Branch operations
  getCurrentBranch(repoPath: string): Promise<string>;
  createBranch(repoPath: string, branchName: string, baseBranch?: string): Promise<void>;
  checkoutBranch(repoPath: string, branchName: string): Promise<void>;
  deleteBranch(repoPath: string, branchName: string): Promise<void>;
  listBranches(repoPath: string): Promise<string[]>;

  // Status
  getStatus(repoPath: string): Promise<GitStatus>;
  isClean(repoPath: string): Promise<boolean>;

  // Diff
  getDiff(repoPath: string, options?: DiffOptions): Promise<FileDiff[]>;
  getDiffStats(repoPath: string, options?: DiffOptions): Promise<DiffStats>;

  // Commit
  stageAll(repoPath: string): Promise<void>;
  commit(repoPath: string, message: string): Promise<string>; // returns commit hash
  getLog(repoPath: string, options?: LogOptions): Promise<GitLogEntry[]>;

  // Remote
  push(repoPath: string, branch: string, remote?: string): Promise<void>;
  pull(repoPath: string, branch: string, remote?: string): Promise<void>;
}

interface GitStatus {
  branch: string;
  clean: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}

interface DiffOptions {
  baseBranch?: string;   // compare against this branch
  headBranch?: string;   // compare this branch
  paths?: string[];      // limit to specific files
  cached?: boolean;      // staged changes only
}

interface FileDiff {
  filePath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface DiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

interface LogOptions {
  limit?: number;
  since?: string;       // date string
  branch?: string;
}

interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}
```

**Phase 1:** `LocalGitOps` - runs `git` commands via `child_process.exec`
**Future:** `LibGit2Ops` - uses native bindings for performance

---

### 4b. Worktree Manager (`IWorktreeManager`)

Manages git worktrees for agent isolation. When multiple agents run on different tasks in the same project, each needs its own working directory. Worktrees let multiple branches be checked out simultaneously from the same repo without conflicts.

```typescript
// src/main/interfaces/worktree-manager.ts

interface IWorktreeManager {
  // Create a worktree for an agent to work in
  create(repoPath: string, options: CreateWorktreeOptions): Promise<Worktree>;

  // Get existing worktree for a branch/task
  get(repoPath: string, identifier: string): Promise<Worktree | null>;

  // List all worktrees for a repo
  list(repoPath: string): Promise<Worktree[]>;

  // Lock a worktree (agent is running in it)
  lock(worktreePath: string, reason?: string): Promise<void>;

  // Unlock a worktree (agent finished)
  unlock(worktreePath: string): Promise<void>;

  // Delete a specific worktree
  delete(worktreePath: string, force?: boolean): Promise<void>;

  // Clean up stale/orphaned worktrees (no running agent, task done/cancelled)
  cleanup(repoPath: string): Promise<CleanupReport>;
}

interface Worktree {
  path: string;           // absolute path to the worktree directory
  branch: string;         // branch checked out in this worktree
  taskId?: string;        // task this worktree was created for
  isMain: boolean;        // is this the main working tree
  isLocked: boolean;      // agent is currently running in this worktree
  lockReason?: string;    // e.g., "agent run abc-123"
  createdAt: string;
}

interface CreateWorktreeOptions {
  branchName: string;       // branch to checkout in the worktree
  baseBranch?: string;      // create new branch from this base (default: main/master)
  createBranch?: boolean;   // create the branch if it doesn't exist (default: true)
  taskId?: string;          // associate with a task (for cleanup tracking)
}

interface CleanupReport {
  removed: number;
  paths: string[];
  errors: string[];
}
```

**Worktree storage convention:**
```
<project-path>/.agent-worktrees/
├── task-abc-123/          # worktree for task abc-123
│   ├── src/               # full working copy on branch agent/task-abc-123
│   └── ...
├── task-def-456/          # worktree for task def-456
│   ├── src/
│   └── ...
└── .gitkeep
```

The `.agent-worktrees/` directory is added to `.gitignore` automatically on first worktree creation.

**Lifecycle:**
1. **Agent starts** → `worktreeManager.create()` → agent's `cwd` is set to the worktree path
2. **Agent running** → worktree is locked (`lock()`) to prevent accidental cleanup
3. **Agent completes** → worktree unlocked (`unlock()`), kept for review/retry
4. **Task done/cancelled** → worktree deleted by supervisor cleanup or manual action
5. **Supervisor tick** → `cleanup()` removes worktrees for completed/cancelled tasks

**Key benefit:** The main repo stays on its current branch (usually `main`). Agents never touch it. No branch switching conflicts. Multiple agents can work on different tasks in the same project simultaneously.

**Phase 1:** Not needed (no agents yet)
**Phase 2:** `LocalWorktreeManager` - uses `git worktree add/remove/list` via `child_process`
**Future:** Could manage remote dev environments or cloud workspaces

---

### 5. SCM Platform (`IScmPlatform`)

Interacts with the source code hosting platform. Phase 1: GitHub. Future: GitLab, Bitbucket.

```typescript
// src/main/interfaces/scm-platform.ts

interface IScmPlatform {
  readonly name: string; // 'github', 'gitlab', 'bitbucket'

  // Check if authenticated / available
  isAvailable(): Promise<boolean>;

  // Pull Requests
  createPR(options: CreatePROptions): Promise<PullRequest>;
  getPR(repoUrl: string, prNumber: number): Promise<PullRequest>;
  listPRs(repoUrl: string, filters?: PRFilters): Promise<PullRequest[]>;
  mergePR(repoUrl: string, prNumber: number): Promise<void>;

  // Issues (for import)
  listIssues(repoUrl: string, filters?: IssueFilters): Promise<ScmIssue[]>;
  getIssue(repoUrl: string, issueNumber: number): Promise<ScmIssue>;

  // Repo info
  getRepoInfo(repoPath: string): Promise<RepoInfo | null>;
}

interface CreatePROptions {
  repoUrl: string;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
  draft?: boolean;
}

interface PullRequest {
  number: number;
  title: string;
  body: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  headBranch: string;
  baseBranch: string;
  createdAt: string;
}

interface PRFilters {
  state?: 'open' | 'closed' | 'all';
  author?: string;
  limit?: number;
}

interface ScmIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  url: string;
  createdAt: string;
}

interface IssueFilters {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  limit?: number;
}

interface RepoInfo {
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
}
```

**Phase 1:** `GitHubPlatform` - uses `gh` CLI
**Future:** `GitLabPlatform`, `BitbucketPlatform`

---

### 6. Notification Channel (`INotificationChannel`)

Sends notifications and prompts to the user through various channels. Phase 1: Electron desktop notifications (one-way). Phase 4: Telegram, Slack (bidirectional with prompt/response support).

```typescript
// src/main/interfaces/notification-channel.ts

interface INotificationChannel {
  readonly type: string;           // 'desktop', 'telegram', 'slack'
  readonly displayName: string;

  isAvailable(): Promise<boolean>;

  // Send a notification (one-way)
  send(notification: WorkflowNotification): Promise<void>;

  // Send a prompt and wait for response (bidirectional)
  sendPrompt(prompt: WorkflowPrompt): Promise<void>;
}

interface INotificationRouter {
  // Register a channel
  register(channel: INotificationChannel): void;

  // Broadcast to all active channels
  broadcast(notification: WorkflowNotification): Promise<void>;

  // Send a prompt to all active channels
  broadcastPrompt(prompt: WorkflowPrompt): Promise<void>;

  // Get all registered channels
  getChannels(): INotificationChannel[];
}

interface WorkflowNotification {
  type: string;                    // 'agent.completed', 'task.status_changed', etc.
  title: string;
  body: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  context: NotificationContext;
  timestamp: string;
}

interface WorkflowPrompt {
  promptId: string;
  taskId: string;
  type: string;                    // 'needs_info', 'options', 'approval', 'changes_requested'
  title: string;
  body: string;
  actions: PromptAction[];
  context: NotificationContext;
  expiresAt?: string;
}
```

**Phase 1:** `DesktopNotificationChannel` - uses Electron's `Notification` API (one-way only)
**Phase 4:** `TelegramChannel`, `SlackChannel` - bidirectional with prompt/response support

Note: `INotificationRouter` allows multiple channels to fire simultaneously (desktop + Slack + Telegram).

---

### 7. Activity Log (`IActivityLog`)

Records events that happen in the system. Phase 1: SQLite. Future: external logging/analytics.

```typescript
// src/main/interfaces/activity-log.ts

interface IActivityLog {
  log(event: ActivityEvent): Promise<void>;
  list(filters: ActivityFilters): Promise<ActivityEvent[]>;
  clear(projectId: string): Promise<void>;
}

interface ActivityEvent {
  id?: string;          // auto-generated if not provided
  projectId: string;
  type: ActivityEventType;
  entityType: 'task' | 'agent_run' | 'project' | 'queue';
  entityId: string;
  title: string;
  metadata?: Record<string, any>;
  createdAt?: string;   // auto-set if not provided
}

type ActivityEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.cancelled'
  | 'queue.started'
  | 'queue.completed'
  | 'queue.item_completed'
  | 'queue.item_failed';

interface ActivityFilters {
  projectId?: string;
  type?: ActivityEventType[];
  entityType?: string;
  limit?: number;
  offset?: number;
  since?: string;       // ISO date
}
```

**Phase 1:** `SqliteActivityLog`
**Future:** Could send to an external analytics service alongside local storage

---

### 8. Storage (`IStorage`)

Generic key-value and blob storage for app data (settings, configs, transcripts, etc.). Phase 1: SQLite. Future: cloud storage.

```typescript
// src/main/interfaces/storage.ts

interface IStorage {
  // Key-value (for settings, configs)
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;

  // Blob-like (for transcripts, large data)
  saveBlob(key: string, data: string | Buffer): Promise<void>;
  getBlob(key: string): Promise<string | Buffer | null>;
  deleteBlob(key: string): Promise<void>;
}
```

**Phase 1:** `SqliteStorage` - stores everything in SQLite (JSON for kv, TEXT/BLOB for blobs)
**Future:** `S3Storage`, `CloudStorage`

---

## File Structure

```
src/main/
├── interfaces/                    # Pure interfaces - NO implementations, ALL methods return Promise
│   ├── task-store.ts
│   ├── project-store.ts
│   ├── agent-framework.ts
│   ├── git-ops.ts
│   ├── scm-platform.ts
│   ├── notifier.ts
│   ├── activity-log.ts
│   ├── storage.ts
│   ├── worktree-manager.ts        # Git worktree lifecycle for agent isolation
│   ├── pipeline-store.ts          # Pipeline definition CRUD
│   ├── pipeline-engine.ts         # Transition validation, execution, history
│   ├── task-event-log.ts          # Comprehensive task event logging
│   ├── notification-channel.ts    # Bidirectional notification channel
│   ├── notification-router.ts     # Routes notifications to active channels
│   ├── prompt-store.ts            # Pending prompt lifecycle management
│   └── workflow-service.ts        # Single entry point for ALL operations
│
├── providers/
│   └── setup.ts                   # Composition root — creates all services, ONLY import of impls
│
├── implementations/               # Concrete implementations
│   ├── sqlite-task-store.ts
│   ├── sqlite-project-store.ts
│   ├── claude-code-agent.ts
│   ├── local-git-ops.ts
│   ├── github-platform.ts
│   ├── electron-notifier.ts
│   ├── sqlite-activity-log.ts
│   ├── sqlite-storage.ts
│   ├── sqlite-pipeline-store.ts
│   ├── local-worktree-manager.ts  # git worktree add/remove/list
│   ├── pipeline-engine.ts         # The state machine runtime
│   ├── sqlite-task-event-log.ts
│   ├── desktop-notification.ts    # Electron Notification API
│   ├── notification-router.ts
│   ├── sqlite-prompt-store.ts
│   └── workflow-service.ts        # The brain - orchestrates everything
│
├── handlers/                      # Pipeline feature modules - guards + hooks organized by concern
│   ├── handler.ts                 # IPipelineHandler interface, GuardRegistry, HookRegistry
│   ├── core-handler.ts            # has_plan, has_branch, no_running_agent, dependencies_resolved
│   ├── agent-handler.ts           # start_agent, stop_agent
│   ├── git-handler.ts             # create_branch, create_worktree
│   ├── pr-review-handler.ts       # has_pr, merge_pr, start_pr_review
│   ├── notification-handler.ts    # notify
│   ├── activity-handler.ts        # log_activity
│   ├── payload-handler.ts         # has_payload_response, inject_payload_context
│   └── outcome-schemas.ts         # OUTCOME_SCHEMAS registry — outcome→payload JSON Schema mapping + validation
│
├── services/                      # Business logic - receives deps via constructor
│   ├── task-service.ts            # Orchestrates task operations + side effects
│   ├── agent-service.ts           # Orchestrates agent runs
│   ├── project-service.ts
│   └── ...
│
├── ipc-handlers.ts                # Thin IPC layer - calls services
├── migrations.ts
└── index.ts                       # App init → createAppServices() → register IPC
```

### Key Rule

```
interfaces/       → imported by everything (services, implementations, ipc-handlers)
implementations/  → imported ONLY by providers/setup.ts (the composition root)
services/         → imported by ipc-handlers.ts
```

No file in `services/` or `ipc-handlers.ts` ever imports from `implementations/`. Dependencies flow through constructors, not imports.

---

## How Swapping Works

Example: replacing SQLite task store with Linear.

**Step 1:** Create new implementation
```typescript
// src/main/implementations/linear-task-store.ts
import { ITaskStore, Task, TaskFilters, ... } from '../interfaces/task-store';

export class LinearTaskStore implements ITaskStore {
  constructor(private apiKey: string) {}

  async listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]> {
    // Call Linear API, map Linear issues to Task objects
  }

  async createTask(data: CreateTaskInput): Promise<Task> {
    // Create Linear issue, return as Task
  }

  // ... implement all interface methods
}
```

**Step 2:** Update setup.ts (one line change in the composition root)
```typescript
// Before
const taskStore = new SqliteTaskStore(db);

// After
const taskStore = new LinearTaskStore(config.linearApiKey);
```

**Step 3:** Done. No other file changes. The `taskStore` variable is still typed as `ITaskStore`, so everything downstream (WorkflowService, PipelineEngine, IPC handlers) works unchanged.

---

## Design Constraints

### 1. Workflow-Only PR Merge
PRs are merged **exclusively through the Workflow Service** — which all 3 UIs (Electron app, Telegram/Slack, CLI) call. The admin clicks "Merge & Complete" in the Electron UI, taps the merge action on a Telegram notification, or runs a CLI command — all of which call `workflowService.mergePR(taskId)` → `IScmPlatform.mergePR()` → auto-transition to Done. Merging manually on GitHub/GitLab bypasses the pipeline and may leave the task in an inconsistent state. This is a deliberate tradeoff: the Workflow Service is the single source of truth for task lifecycle.

### 2. One Active Agent Per Task (For Now)
Only one agent can run against a task at a time, enforced by the `no_running_agent` guard. Multiple tasks in the same project can have agents running in parallel. The data model does NOT hard-limit this — `agent_runs` supports multiple runs per task. The constraint is purely in the pipeline guard, making it easy to relax in the future for large tasks that need multiple parallel PRs.

### 3. Agent Context Assembly
When an agent resumes after a human-in-the-loop pause (needs info answered, option selected, changes requested), it needs the full conversation history. All task communication is stored in the **task event log** — similar to a GitHub issue where everything lives in one chronological stream. The `AgentContextBuilder` assembles the prompt from: task metadata → plan → event log (filtered for payload exchanges) → latest payload response. This ensures agents never lose context across pause/resume cycles.

### 5. Task Supervisor (Background Health Loop)
A background interval loop runs in the main process, periodically scanning for unhealthy states and taking corrective action. This is the safety net that ensures nothing silently rots.

```typescript
interface ITaskSupervisor {
  start(): void;           // begin the interval loop
  stop(): void;            // stop the loop (app quit)
  runOnce(): Promise<void>; // manual trigger (for testing / CLI)
}

interface SupervisorConfig {
  enabled: boolean;                // default: true
  intervalMs: number;              // default: 60000 (1 min)
  agentTimeoutMs: number;          // default: 600000 (10 min) - override per-agent config
  waitingTaskReminderMs: number;   // default: 86400000 (24h)
  orphanedRunThresholdMs: number;  // default: 300000 (5 min with no heartbeat)
  activeNoAgentThresholdMs: number; // default: 600000 (10 min)
}
```

**What it checks each tick:**

| Check | Condition | Action |
|-------|-----------|--------|
| Dead agent process | `agent_run.status=running` but OS process doesn't exist | Mark failed → trigger auto-retry or transition to `failed` |
| Agent timeout | `agent_run` running > `timeoutPerAttempt` | Kill process tree → trigger auto-retry or fail |
| Stuck waiting task | Task in `waiting` category > `waitingTaskReminderMs` | Send reminder notification to all channels |
| Orphaned retry | Scheduled retry whose delay has passed but never started | Execute retry now |
| Active task, no agent | Task in `active` category with no running `agent_run` for > threshold | Send warning notification |

The supervisor logs all actions to the task event log (`supervisor.timeout`, `supervisor.orphan_recovered`, `supervisor.reminder_sent`) so everything is traceable. Settings are configurable globally in the Settings page.

### 6. Structured Output for Agent → Pipeline Communication
Agents communicate structured data (questions, options, review comments) back to the pipeline via **structured output** — a standard feature in most agent frameworks. The agent adapter parses the structured output into the appropriate `TransitionPayload` type. No custom parsing markers needed; this uses the native structured output capability of the underlying LLM/agent framework.

---

## Task Artifacts

Tasks accumulate **artifacts** over their lifecycle — branches, PRs, commits, diffs, and links. These are first-class data, not just fields on the task.

```typescript
interface TaskArtifact {
  id: string;
  taskId: string;
  phaseId?: string;             // null = task-level artifact, set = phase-scoped
  type: 'branch' | 'pull_request' | 'commit' | 'diff' | 'link' | 'document' | 'mock';
  label: string;
  url?: string;
  content?: string;             // full content for document/mock artifacts
  filePath?: string;            // file path for document artifacts
  metadata: Record<string, any>;
  createdAt: string;
  createdBy: 'user' | 'agent' | 'system';
  agentRunId?: string;
}

// Artifact-specific metadata examples:
// branch:       { branchName: 'agent/task-123', baseBranch: 'main' }
// pull_request: { prNumber: 45, state: 'open', headBranch: 'agent/task-123' }
// commit:       { hash: 'abc123', message: 'Add auth middleware', branch: 'agent/task-123' }
// link:         { description: 'Design doc' }
// document:     { title: 'Technical Design', format: 'markdown' }
// mock:         { purpose: 'API response mock', format: 'json' }
```

Artifacts are stored in a `task_artifacts` table and managed through `ITaskStore`:

```typescript
// Added to ITaskStore
interface ITaskStore {
  // ... existing methods ...

  // Artifacts
  addArtifact(taskId: string, artifact: CreateArtifactInput): Promise<TaskArtifact>;
  listArtifacts(taskId: string, type?: string): Promise<TaskArtifact[]>;
  getArtifact(artifactId: string): Promise<TaskArtifact | null>;
  updateArtifact(artifactId: string, data: Partial<TaskArtifact>): Promise<TaskArtifact>;
  removeArtifact(artifactId: string): Promise<void>;
}
```

The **Merge button** on the task detail page reads the `pull_request` artifact to get the PR number, calls `IScmPlatform.mergePR()`, updates the artifact state to `merged`, and triggers the pipeline transition to Done.

---

## Implications for Phase Docs

This architecture affects all phases:

- **Phase 1:** Build interfaces + SQLite implementations. Composition root (`setup.ts`) wires everything via constructor injection. This is slightly more setup upfront but pays off immediately.
- **Phase 2:** Add `IAgent` interface + `ClaudeCodeAgent` implementation. `AgentService` receives `IAgentFramework` via constructor.
- **Phase 3:** Add more `IAgent` implementations (Cursor, Aider). Add HTTP server that receives `AppServices` at startup. CLI talks to HTTP server.
- **Phase 4:** `INotifier` + `IActivityLog` get their real usage. Dashboard reads from interfaces.
- **Phase 5:** `IScmPlatform` used for GitHub import. Could swap to GitLab with zero UI changes.
