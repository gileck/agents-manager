# Phase 1: Core Data Layer + Pipeline Engine + TestKit

**Goal:** Build all stores, the pipeline engine, and the test infrastructure so everything is testable from day one.

---

## What Gets Built

### Interfaces
- `ITaskStore` — Task CRUD, query, filtering
- `IProjectStore` — Project CRUD
- `IPipelineStore` — Pipeline CRUD, lookup by task type
- `ITaskEventLog` — Chronological event log per task
- `IActivityLog` — System-wide activity log
- `IStorage` — Key-value settings storage
- `IPipelineEngine` — Transition validation, guard checking, hook execution, atomic transitions

### Implementations
- `SqliteTaskStore`
- `SqliteProjectStore`
- `SqlitePipelineStore`
- `SqliteTaskEventLog`
- `SqliteActivityLog`

### Pipeline Engine
- Guard registry (pluggable guard functions, e.g. `has_pr`, `has_plan`)
- Hook registry (pluggable hook functions, e.g. `start_agent`, `merge_pr`)
- JSON pipeline definitions stored in database
- Atomic transitions (SQLite single-writer guarantees)
- Seeded pipelines: Simple, Feature, Bug

### Config System
- Read `~/.agents-manager/config.json` (global)
- Read `<project>/.agents-manager/config.json` (project-level)
- Merge chain: defaults < global < project

### Composition Root
- `setup.ts` with constructor injection
- All services wired via interfaces, swappable implementations

### TestKit (from day one)
- In-memory SQLite test context (`createTestContext()`)
- Mock/stub implementations for all interfaces
- Test helpers for creating tasks, projects, pipelines

### E2E Tests
- Project CRUD
- Task CRUD
- Task dependencies (blocking/blocked-by)
- Pipeline transitions (valid and invalid)
- Guard validation (pass and fail)
- Hook execution
- Event logging

---

## Database Tables (8)

### `pipelines`
```sql
CREATE TABLE pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  statuses TEXT NOT NULL,       -- JSON array of status definitions
  transitions TEXT NOT NULL,    -- JSON array of transition objects
  default_for_task_type TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### `projects`
```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  description TEXT,
  config TEXT,                  -- JSON project config
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### `tasks`
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT CHECK(priority IN ('critical','high','medium','low')),
  size TEXT CHECK(size IN ('xs','s','m','l','xl')),
  complexity TEXT CHECK(complexity IN ('simple','moderate','complex')),
  status TEXT NOT NULL,
  assignee TEXT,
  tags TEXT,                    -- JSON array
  branch_name TEXT,
  pr_link TEXT,
  parent_task_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(pipeline_id) REFERENCES pipelines(id),
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(parent_task_id) REFERENCES tasks(id)
);
```

### `task_dependencies`
```sql
CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  PRIMARY KEY(task_id, depends_on_task_id),
  FOREIGN KEY(task_id) REFERENCES tasks(id),
  FOREIGN KEY(depends_on_task_id) REFERENCES tasks(id)
);
```

### `transition_history`
```sql
CREATE TABLE transition_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  triggered_by TEXT NOT NULL,   -- "manual" | "agent_result"
  payload TEXT,                 -- JSON transition payload
  created_at INTEGER NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
```

### `task_events`
```sql
CREATE TABLE task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  category TEXT CHECK(category IN ('status_change','agent_tool','guard_check','hook_execution','user_edit','payload_exchange','error')),
  severity TEXT CHECK(severity IN ('info','warning','error')),
  message TEXT NOT NULL,
  data TEXT,                    -- JSON
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE INDEX idx_task_events_task_id ON task_events(task_id);
CREATE INDEX idx_task_events_timestamp ON task_events(timestamp);
```

### `settings`
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### `activity_log`
```sql
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  actor TEXT NOT NULL,          -- "user" | "agent" | "system"
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,    -- "task" | "project" | "pipeline" | "agent_run"
  entity_id TEXT NOT NULL,
  details TEXT,                 -- JSON
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_activity_log_timestamp ON activity_log(timestamp);
CREATE INDEX idx_activity_log_entity ON activity_log(entity_type, entity_id);
```

---

## Seeded Pipelines

### Simple
```json
{
  "id": "simple",
  "name": "Simple",
  "statuses": [
    { "name": "open", "displayName": "Open", "category": "backlog" },
    { "name": "in_progress", "displayName": "In Progress", "category": "active" },
    { "name": "done", "displayName": "Done", "category": "completed" }
  ],
  "transitions": [
    { "from": "open", "to": "in_progress", "trigger": { "type": "manual" } },
    { "from": "in_progress", "to": "done", "trigger": { "type": "manual" } },
    { "from": "in_progress", "to": "open", "trigger": { "type": "manual" } }
  ],
  "default_for_task_type": "simple"
}
```

### Feature (Standard)
```json
{
  "id": "feature",
  "name": "Feature",
  "statuses": [
    { "name": "open", "displayName": "Open", "category": "backlog" },
    { "name": "planning", "displayName": "Planning", "category": "active" },
    { "name": "planned", "displayName": "Planned", "category": "active" },
    { "name": "in_progress", "displayName": "In Progress", "category": "active" },
    { "name": "pr_review", "displayName": "PR Review", "category": "waiting" },
    { "name": "changes_requested", "displayName": "Changes Requested", "category": "active" },
    { "name": "done", "displayName": "Done", "category": "completed" },
    { "name": "failed", "displayName": "Failed", "category": "blocked" }
  ],
  "transitions": [
    { "from": "open", "to": "planning", "trigger": { "type": "manual" }, "hooks": [{ "type": "start_agent", "params": { "mode": "plan" } }] },
    { "from": "planning", "to": "planned", "trigger": { "type": "agent_result", "outcome": "plan_complete" } },
    { "from": "planning", "to": "failed", "trigger": { "type": "agent_result", "outcome": "failed" } },
    { "from": "planned", "to": "in_progress", "trigger": { "type": "manual" }, "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },
    { "from": "in_progress", "to": "pr_review", "trigger": { "type": "agent_result", "outcome": "pr_ready" } },
    { "from": "in_progress", "to": "failed", "trigger": { "type": "agent_result", "outcome": "failed" } },
    { "from": "pr_review", "to": "done", "trigger": { "type": "manual" }, "guards": [{ "type": "has_pr" }], "hooks": [{ "type": "merge_pr" }] },
    { "from": "pr_review", "to": "changes_requested", "trigger": { "type": "manual" } },
    { "from": "changes_requested", "to": "in_progress", "trigger": { "type": "manual" }, "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },
    { "from": "open", "to": "in_progress", "trigger": { "type": "manual" }, "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] }
  ],
  "default_for_task_type": "feature"
}
```

### Bug
```json
{
  "id": "bug",
  "name": "Bug",
  "statuses": [
    { "name": "open", "displayName": "Open", "category": "backlog" },
    { "name": "in_progress", "displayName": "In Progress", "category": "active" },
    { "name": "pr_review", "displayName": "PR Review", "category": "waiting" },
    { "name": "done", "displayName": "Done", "category": "completed" },
    { "name": "failed", "displayName": "Failed", "category": "blocked" }
  ],
  "transitions": [
    { "from": "open", "to": "in_progress", "trigger": { "type": "manual" }, "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },
    { "from": "in_progress", "to": "pr_review", "trigger": { "type": "agent_result", "outcome": "pr_ready" } },
    { "from": "in_progress", "to": "failed", "trigger": { "type": "agent_result", "outcome": "failed" } },
    { "from": "pr_review", "to": "done", "trigger": { "type": "manual" }, "guards": [{ "type": "has_pr" }], "hooks": [{ "type": "merge_pr" }] },
    { "from": "pr_review", "to": "open", "trigger": { "type": "manual" } }
  ],
  "default_for_task_type": "bug"
}
```

---

## Key Interfaces

```typescript
interface ITaskStore {
  getTask(id: string): Promise<Task | null>
  listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]>
  createTask(data: CreateTaskInput): Promise<Task>
  updateTask(id: string, data: UpdateTaskInput): Promise<Task>
  deleteTask(id: string): Promise<void>
  addDependency(taskId: string, dependsOnTaskId: string): Promise<void>
  removeDependency(taskId: string, dependsOnTaskId: string): Promise<void>
  getDependencies(taskId: string): Promise<Task[]>
  getDependents(taskId: string): Promise<Task[]>
}

interface IProjectStore {
  getProject(id: string): Promise<Project | null>
  listProjects(): Promise<Project[]>
  createProject(data: CreateProjectInput): Promise<Project>
  updateProject(id: string, data: UpdateProjectInput): Promise<Project>
  deleteProject(id: string): Promise<void>
}

interface IPipelineStore {
  getPipeline(id: string): Promise<Pipeline | null>
  listPipelines(): Promise<Pipeline[]>
  createPipeline(data: CreatePipelineInput): Promise<Pipeline>
  updatePipeline(id: string, data: UpdatePipelineInput): Promise<Pipeline>
  deletePipeline(id: string): Promise<void>
  getPipelineForTaskType(taskType: string): Promise<Pipeline | null>
}

interface IPipelineEngine {
  getValidTransitions(task: Task, trigger?: TransitionTrigger): Promise<Transition[]>
  executeTransition(task: Task, toStatus: string, context?: TransitionContext): Promise<Task>
  registerGuard(name: string, fn: GuardFn): void
  registerHook(name: string, fn: HookFn): void
}

interface ITaskEventLog {
  log(event: CreateTaskEvent): Promise<TaskEvent>
  getEvents(taskId: string, filters?: EventFilters): Promise<TaskEvent[]>
}

interface IActivityLog {
  log(entry: CreateActivityEntry): Promise<ActivityEntry>
  getEntries(filters?: ActivityFilters): Promise<ActivityEntry[]>
}
```

---

## File Structure

```
src/main/
  interfaces/
    task-store.ts
    project-store.ts
    pipeline-store.ts
    pipeline-engine.ts
    task-event-log.ts
    activity-log.ts
    storage.ts
  stores/
    sqlite-task-store.ts
    sqlite-project-store.ts
    sqlite-pipeline-store.ts
    sqlite-task-event-log.ts
    sqlite-activity-log.ts
  services/
    pipeline-engine.ts
    config-service.ts
  providers/
    setup.ts
  migrations.ts

src/shared/
  types.ts
  ipc-channels.ts

tests/
  helpers/
    test-context.ts
  e2e/
    project-crud.test.ts
    task-crud.test.ts
    task-dependencies.test.ts
    pipeline-transitions.test.ts
    guard-validation.test.ts
    hook-execution.test.ts
    event-logging.test.ts
```

---

## Dependencies
None (first phase).

## User Can
Run tests. All core logic is verified.
