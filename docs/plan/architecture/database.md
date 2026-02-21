# Database Layer

The authoritative reference for all persistence in Agents Manager. Every table, index, migration, and storage pattern is defined here. Phase docs may reference schemas for context, but this document is the single source of truth.

See also: [overview.md](overview.md) | [projects.md](projects.md)

---

## Overview

- **Engine:** SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), a synchronous C++ binding for Node.js
- **Location:** `~/Library/Application Support/agents-manager/agents-manager.db`
- **WAL mode** enabled at startup for concurrent read performance (`PRAGMA journal_mode = WAL`)
- **Async interfaces:** All access goes through async interfaces (`ITaskStore`, `IProjectStore`, `IPipelineStore`, etc.) even though the underlying SQLite calls are synchronous. This allows future migration to remote databases without refactoring callers. SQLite implementations wrap sync operations in `Promise.resolve()` or use `async/await` naturally.
- **Migrations** run at app startup, each wrapped in a transaction. If any migration fails, the app refuses to start.
- **JSON as TEXT:** SQLite has no native JSON column type. All structured data (arrays, objects) is stored as `TEXT` and parsed with `JSON.parse()` on read.

---

## Complete Schema

All tables across all phases, consolidated in one place.

### Phase 1: Foundation

#### `pipelines` -- Pipeline definitions (JSON state machines)

```sql
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  definition TEXT NOT NULL,        -- full JSON pipeline definition
  is_default INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

The `definition` column holds the complete pipeline JSON -- statuses, transitions, guards, hooks, categories, and UI config. See `pipeline/json-contract.md` for the schema.

#### `projects` -- Local codebases

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

The `path` column stores the absolute filesystem path to the project directory. It is immutable after creation.

#### `tasks` -- Units of work

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pipeline_id TEXT NOT NULL DEFAULT 'simple',
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  size TEXT NOT NULL DEFAULT 'm',
  complexity TEXT NOT NULL DEFAULT 'medium',
  tags TEXT DEFAULT '[]',           -- JSON array of strings
  plan TEXT,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

- `status` values are defined by the task's pipeline, not hardcoded. The default `'open'` corresponds to the Simple pipeline's initial status.
- `tags` is a JSON array stored as TEXT (e.g., `'["auth","backend"]'`).
- `plan` holds the implementation plan in markdown, populated by the planning agent in Phase 2.
- `parent_task_id` enables subtask hierarchies. `ON DELETE SET NULL` detaches subtasks when a parent is deleted rather than cascade-deleting them.

#### `task_dependencies` -- Many-to-many task blocking

```sql
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id)
);
```

`task_id` is blocked by `depends_on_task_id`. The `dependencies_resolved` pipeline guard checks this table before allowing transitions to active statuses.

#### `transition_history` -- Pipeline transition audit trail

```sql
CREATE TABLE IF NOT EXISTS transition_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  transition_id TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'user',
  agent_run_id TEXT,
  reason TEXT,
  guards_checked TEXT DEFAULT '[]',  -- JSON array of guard results
  hooks_executed TEXT DEFAULT '[]',  -- JSON array of hook names
  created_at TEXT NOT NULL
);
```

Every status change is recorded here for auditing and debugging. `triggered_by` is one of `'user'`, `'agent'`, `'system'`, or `'supervisor'`.

---

### Phase 2: Agent Execution

#### `agent_runs` -- Agent execution records

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL DEFAULT 'claude-code',
  mode TEXT NOT NULL,               -- 'plan', 'implement', 'review', etc.
  status TEXT NOT NULL DEFAULT 'running',
  model TEXT NOT NULL,
  transcript TEXT DEFAULT '[]',     -- JSON array of AgentMessage
  error TEXT,
  outcome TEXT,                    -- named outcome: 'pr_ready', 'plan_complete', 'needs_info', etc.
  token_usage TEXT,                 -- JSON: { inputTokens, outputTokens, totalCost }
  duration_ms INTEGER DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
```

- `transcript` stores the full conversation as a JSON array of `AgentMessage` objects.
- `token_usage` stores a JSON object with `inputTokens`, `outputTokens`, and `totalCost`.
- `status` is one of: `'running'`, `'completed'`, `'failed'`, `'cancelled'`, `'timeout'`.

#### `task_phases` -- Ordered work chunks within a task

```sql
CREATE TABLE IF NOT EXISTS task_phases (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- 'pending', 'in_progress', 'completed', 'skipped'
  phase_order INTEGER NOT NULL,
  branch_name TEXT,
  pr_url TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);
```

Each task can have multiple phases (ordered sub-units of work). Phases get their own branches, PRs, and artifacts. The task branch serves as the integration branch.

#### `pending_prompts` -- Human-in-the-loop prompt lifecycle

```sql
CREATE TABLE IF NOT EXISTS pending_prompts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- 'needs_info', 'options', 'approval', 'changes_requested'
  data TEXT NOT NULL DEFAULT '{}',  -- JSON: the question/options/review data
  sent_to_channels TEXT DEFAULT '[]', -- JSON array of channel IDs
  status TEXT NOT NULL DEFAULT 'pending',
  response TEXT,                    -- JSON: the human's response
  timeout_at TEXT,
  created_at TEXT NOT NULL,
  responded_at TEXT
);
```

When an agent needs human input (asks a question, presents options, requests approval), a prompt is created here. Notification channels deliver it to the user. When the user responds (from Electron UI, Telegram, Slack, or CLI), the response is stored and the agent resumes. See `notification-system.md` for the full flow.

#### `task_artifacts` -- Branches, PRs, commits, links

```sql
CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  phase_id TEXT REFERENCES task_phases(id) ON DELETE SET NULL,
  type TEXT NOT NULL,               -- 'branch', 'pull_request', 'commit', 'diff', 'link', 'document', 'mock'
  label TEXT NOT NULL,
  url TEXT,
  content TEXT,                     -- full content for document/mock artifacts
  file_path TEXT,                   -- file path for document artifacts
  metadata TEXT DEFAULT '{}',       -- JSON: type-specific data
  created_by TEXT NOT NULL DEFAULT 'system',
  agent_run_id TEXT REFERENCES agent_runs(id),
  created_at TEXT NOT NULL
);
```

Tasks accumulate artifacts over their lifecycle. The `metadata` JSON varies by type:
- **branch:** `{ branchName, baseBranch }`
- **pull_request:** `{ prNumber, state, headBranch }`
- **commit:** `{ hash, message, branch }`
- **link:** `{ description }`
- **document:** `{ title, format }`
- **mock:** `{ purpose, format }`

#### `task_events` -- Comprehensive task event log

```sql
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  category TEXT NOT NULL,           -- 'transition', 'agent', 'payload', 'user', 'supervisor'
  type TEXT NOT NULL,               -- e.g., 'status.changed', 'agent.started'
  summary TEXT NOT NULL,
  data TEXT DEFAULT '{}',           -- JSON payload
  actor_type TEXT NOT NULL,         -- 'user', 'agent', 'system', 'supervisor'
  actor_name TEXT,
  agent_run_id TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL
);
```

The event log is the single chronological record of everything that happens to a task -- like a GitHub issue thread. The `AgentContextBuilder` reads this to assemble full context when an agent resumes after a pause. See `pipeline/event-log.md`.

---

### Phase 3: Agent CLI + Multi-Agent

#### `task_notes` -- User/agent commentary

```sql
CREATE TABLE IF NOT EXISTS task_notes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);
```

Free-form notes attached to tasks. `author` is typically `'user'` or the agent type (e.g., `'claude-code'`).

---

### Phase 4: Dashboard + Polish

#### `activity_log` -- High-level project activity feed

```sql
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,               -- e.g., 'task.created', 'agent.completed'
  entity_type TEXT NOT NULL,        -- 'task', 'agent_run', 'project', 'queue'
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',       -- JSON: additional context
  created_at TEXT NOT NULL
);
```

The activity log is a project-scoped feed displayed on the dashboard. It is distinct from `task_events` -- the activity log tracks high-level events across a project, while `task_events` tracks granular events within a single task.

---

### Phase 5: Advanced

#### `task_templates` -- Pre-defined task templates

```sql
CREATE TABLE IF NOT EXISTS task_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description_template TEXT DEFAULT '',
  default_priority TEXT DEFAULT 'medium',
  default_size TEXT DEFAULT 'm',
  default_complexity TEXT DEFAULT 'medium',
  default_tags TEXT DEFAULT '[]',   -- JSON array of strings
  is_builtin INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Templates pre-fill task fields when creating new tasks. `is_builtin` marks templates that ship with the app (e.g., "Bug Fix", "Feature", "Refactor") and cannot be deleted by the user.

#### `agent_queue` -- Sequential agent execution queue

```sql
CREATE TABLE IF NOT EXISTS agent_queue (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL,
  mode TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL
);
```

The queue holds pending agent executions. Items are processed sequentially by position within a project. `status` is one of: `'queued'`, `'running'`, `'completed'`, `'failed'`, `'cancelled'`.

#### `tasks` schema addition

```sql
ALTER TABLE tasks ADD COLUMN source_url TEXT;
```

Added in Phase 5 to track the origin URL when tasks are imported from GitHub Issues or other external sources.

---

### Settings (from template)

#### `settings` -- Key-value settings store

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

UI preferences and application settings stored as key-value pairs. Used for user preferences (theme, layout), supervisor config, and notification channel settings. Agent configuration is **not** stored here -- it lives on disk in `config.json` files (see `agent-platform.md` for the config merge chain).

---

## Indexes

All indexes across all tables, grouped by purpose.

### Task Lookups

```sql
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
```

`idx_tasks_project_id` is the most critical index -- every task listing is scoped to a project.

### Transition History

```sql
CREATE INDEX idx_transition_history_task ON transition_history(task_id);
CREATE INDEX idx_transition_history_created ON transition_history(created_at);
```

### Agent Runs

```sql
CREATE INDEX idx_agent_runs_task ON agent_runs(task_id);
CREATE INDEX idx_agent_runs_project ON agent_runs(project_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
```

`idx_agent_runs_status` supports the supervisor's scan for running agents that may have timed out or died.

### Task Artifacts

```sql
CREATE INDEX idx_task_artifacts_task ON task_artifacts(task_id);
CREATE INDEX idx_task_artifacts_type ON task_artifacts(type);
CREATE INDEX idx_task_artifacts_phase ON task_artifacts(phase_id);
```

### Task Phases

```sql
CREATE INDEX idx_task_phases_task ON task_phases(task_id);
CREATE INDEX idx_task_phases_status ON task_phases(status);
```

### Task Events

```sql
CREATE INDEX idx_task_events_task ON task_events(task_id);
CREATE INDEX idx_task_events_category ON task_events(category);
CREATE INDEX idx_task_events_created ON task_events(created_at);
```

### Task Notes

```sql
CREATE INDEX idx_task_notes_task ON task_notes(task_id);
```

### Activity Log

```sql
CREATE INDEX idx_activity_project ON activity_log(project_id);
CREATE INDEX idx_activity_type ON activity_log(type);
CREATE INDEX idx_activity_created ON activity_log(created_at);
```

### Agent Queue

```sql
CREATE INDEX idx_queue_project ON agent_queue(project_id);
CREATE INDEX idx_queue_position ON agent_queue(position);
```

### Pending Prompts

```sql
CREATE INDEX idx_prompts_task ON pending_prompts(task_id);
CREATE INDEX idx_prompts_status ON pending_prompts(status);
```

---

## Migration System

Migrations are defined in `src/main/migrations.ts` and executed by the template's `initDatabase()` function in `template/main/services/database.ts`.

### How It Works

1. At app startup, `initDatabase()` is called from `src/main/index.ts`
2. The template creates a `migrations` table if it does not exist:
   ```sql
   CREATE TABLE IF NOT EXISTS migrations (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     applied_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   ```
3. Each migration in the list is checked against `migrations.name`
4. Unapplied migrations run sequentially, each wrapped in a transaction
5. On success, the migration name is recorded in the `migrations` table
6. On failure, the transaction rolls back and the app refuses to start

### Startup Entry Point

```typescript
// src/main/index.ts
import { initDatabase } from '@template/main/services/database';
import { getMigrations } from './migrations';

initDatabase({
  filename: 'agents-manager.db',
  migrations: getMigrations(),
});
```

### Migration List

Migrations are numbered sequentially. Each migration is an object with `name` and `sql`:

```typescript
// src/main/migrations.ts
import type { Migration } from '@template/main/services/database';

export function getMigrations(): Migration[] {
  return [
    // Phase 1
    { name: '001_create_pipelines',         sql: '...' },
    { name: '002_create_projects',          sql: '...' },
    { name: '003_create_tasks',             sql: '...' },
    { name: '004_create_task_dependencies', sql: '...' },
    { name: '005_create_transition_history',sql: '...' },
    { name: '006_seed_simple_pipeline',     sql: '...' },
    { name: '007_create_indexes_phase1',    sql: '...' },

    // Phase 2
    { name: '008_create_agent_runs',        sql: '...' },
    { name: '009_create_task_phases',       sql: '...' },
    { name: '010_create_task_artifacts',    sql: '...' },
    { name: '011_create_task_events',       sql: '...' },
    { name: '012_create_pending_prompts',   sql: '...' },
    { name: '013_create_indexes_phase2',    sql: '...' },
    { name: '014_create_indexes_prompts',   sql: '...' },

    // Phase 3
    { name: '015_create_task_notes',        sql: '...' },
    { name: '016_create_indexes_phase3',    sql: '...' },

    // Phase 4
    { name: '017_create_activity_log',      sql: '...' },
    { name: '018_create_indexes_phase4',    sql: '...' },
    { name: '019_create_settings',          sql: '...' },

    // Phase 5
    { name: '020_create_task_templates',    sql: '...' },
    { name: '021_create_agent_queue',       sql: '...' },
    { name: '022_add_tasks_source_url',     sql: '...' },
    { name: '023_create_indexes_phase5',    sql: '...' },
    { name: '024_seed_builtin_templates',   sql: '...' },
  ];
}
```

### Rules

- Migration names must be unique. The `UNIQUE` constraint on `migrations.name` enforces this.
- Migrations are append-only. Never modify a migration after it has shipped. To change a table, add a new migration with `ALTER TABLE`.
- Keep migrations small and focused. One table or one concern per migration.
- Indexes get their own migrations (grouped by phase) so they can be re-run or adjusted independently.

---

## JSON Storage Patterns

SQLite stores all JSON as `TEXT`. The application layer is responsible for serialization and deserialization.

### Column-to-Type Mapping

| Column | Table | JSON Type | TypeScript Type |
|--------|-------|-----------|-----------------|
| `tags` | `tasks` | Array of strings | `string[]` |
| `definition` | `pipelines` | Full pipeline object | `PipelineDefinition` |
| `transcript` | `agent_runs` | Array of messages | `AgentMessage[]` |
| `token_usage` | `agent_runs` | Object | `TokenUsage` |
| `metadata` | `task_artifacts`, `activity_log` | Object | `Record<string, any>` |
| `data` | `task_events`, `pending_prompts` | Object | `Record<string, any>` |
| `guards_checked` | `transition_history` | Array | `GuardResult[]` |
| `hooks_executed` | `transition_history` | Array | `string[]` |
| `sent_to_channels` | `pending_prompts` | Array of strings | `string[]` |
| `response` | `pending_prompts` | Object | `PromptResponse` |
| `default_tags` | `task_templates` | Array of strings | `string[]` |

### Read Pattern

Always use `JSON.parse()` with try-catch when reading JSON columns from the database:

```typescript
function parseJsonColumn<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error('Corrupted JSON in database:', raw);
    return fallback;
  }
}

// Usage in a store implementation
const rows = db.prepare('SELECT * FROM tasks WHERE project_id = ?').all(projectId) as TaskRow[];

return rows.map(row => ({
  ...row,
  tags: parseJsonColumn<string[]>(row.tags, []),
}));
```

### Write Pattern

Always use `JSON.stringify()` when writing JSON columns:

```typescript
db.prepare('INSERT INTO tasks (id, tags, ...) VALUES (?, ?, ...)').run(
  id,
  JSON.stringify(tags),
  // ...
);
```

### Type Casting

`db.prepare().all()` returns `unknown[]` in TypeScript. Always cast results to a typed row interface:

```typescript
interface TaskRow {
  id: string;
  project_id: string;
  tags: string;  // raw JSON string from DB
  // ...
}

const rows = db.prepare('SELECT * FROM tasks').all() as TaskRow[];
```

---

## Seed Data

### Simple Pipeline (Phase 1)

The default "Simple" pipeline is seeded on first run via migration `006_seed_simple_pipeline`:

```sql
INSERT INTO pipelines (id, name, description, definition, is_default, created_at, updated_at)
VALUES (
  'simple',
  'Simple',
  'Basic task workflow: Open -> In Progress -> Done',
  '{ "statuses": [...], "transitions": [...], ... }',
  1,
  datetime('now'),
  datetime('now')
);
```

The full pipeline JSON definition is documented in `pipeline/json-contract.md`.

### Built-in Task Templates (Phase 5)

Seeded via migration `025_seed_builtin_templates`:

```sql
INSERT INTO task_templates (id, name, description_template, default_priority, default_size, default_complexity, default_tags, is_builtin, created_at, updated_at)
VALUES
  ('bug-fix',   'Bug Fix',    '## Bug\n\n## Steps to Reproduce\n\n## Expected vs Actual', 'high',   's', 'medium', '["bug"]',       1, datetime('now'), datetime('now')),
  ('feature',   'Feature',    '## Summary\n\n## Acceptance Criteria',                      'medium', 'm', 'medium', '["feature"]',   1, datetime('now'), datetime('now')),
  ('refactor',  'Refactor',   '## What to Refactor\n\n## Why\n\n## Approach',              'medium', 'm', 'medium', '["refactor"]',  1, datetime('now'), datetime('now')),
  ('chore',     'Chore',      '## What\n\n## Why',                                         'low',    's', 'low',    '["chore"]',     1, datetime('now'), datetime('now'));
```

Built-in templates have `is_builtin = 1` and cannot be deleted by the user.

---

## Database Location

```
~/Library/Application Support/agents-manager/agents-manager.db
```

This is the standard macOS location for per-user application data. The path is resolved by Electron's `app.getPath('userData')`. The directory is created automatically if it does not exist.

Configured in `src/main/index.ts`:

```typescript
initDatabase({
  filename: 'agents-manager.db',
  migrations: getMigrations(),
});
```

---

## Concurrency

SQLite is single-writer: only one connection can hold a write lock at a time. The application leverages this property for **atomic guard-check-and-transition** in the pipeline engine.

When starting an agent, the pipeline engine wraps the guard check, task status update, and agent run record creation in a single `better-sqlite3` transaction. Because SQLite serializes write transactions, two concurrent `startAgent` calls on the same task cannot both pass the `no_running_agent` guard -- the first transaction acquires the write lock, updates the status, and creates the run record; the second transaction sees the already-updated status and the guard rejects it.

```typescript
// Executed inside PipelineEngineImpl.transition()
const result = db.transaction(() => {
  const guardResults = this.runGuards(task, transition);
  if (!guardResults.every(g => g.passed)) throw new GuardFailedError(guardResults);
  taskStore.updateStatus(task.id, transition.to);
  const run = agentRunStore.create({ taskId: task.id, ... });
  return { guardResults, run };
})();
```

This pattern avoids the need for external locking mechanisms or optimistic concurrency with retry loops. It relies solely on SQLite's built-in write serialization, which `better-sqlite3` exposes synchronously via `db.transaction()`.

WAL mode (enabled at startup) allows concurrent reads to proceed while a write transaction is in progress, so read-heavy operations like listing tasks or querying transition history are not blocked.

---

## ER Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│  pipelines   │       │     projects     │       │  settings    │
│──────────────│       │──────────────────│       │──────────────│
│ id (PK)      │       │ id (PK)          │       │ key (PK)     │
│ name         │       │ name             │       │ value        │
│ description  │       │ path             │       │ updated_at   │
│ definition   │       │ description      │       └──────────────┘
│ is_default   │       │ created_at       │
│ created_at   │       │ updated_at       │       ┌──────────────────┐
│ updated_at   │       │                  │       │ task_templates   │
└──────┬───────┘       └────────┬─────────┘       │──────────────────│
       │                        │                  │ id (PK)          │
       │ N:1                    │ 1:N              │ name             │
       │                        │                  │ ...              │
       │    ┌───────────────────┼──────────┐       └──────────────────┘
       │    │                   │          │
       │    │            ┌──────▼────────┐ │
       │    │            │    tasks      │ │
       │    │            │──────────────-│ │
       └────┼───────────►│ pipeline_id   │ │
            │            │ project_id ───┼─┘
            │            │ parent_task_id│──┐ (self-referencing)
            │            │ id (PK)      │◄─┘
            │            │ ...          │
            │            └──────┬───────┘
            │                   │
            │      ┌────────────┼────────────┬────────────┬────────────┬────────────┐
            │      │            │            │            │            │            │
            │      │ 1:N        │ 1:N        │ 1:N        │ 1:N        │ 1:N        │ 1:N
            │      │            │            │            │            │            │
            │ ┌────▼─────┐ ┌───▼──────┐ ┌───▼──────┐ ┌───▼──────┐ ┌──▼───────────┐ ┌──▼───────────┐
            │ │task_deps  │ │task_     │ │task_     │ │task_     │ │agent_runs    │ │task_phases   │
            │ │──────────-│ │artifacts │ │notes     │ │events    │ │──────────────│ │──────────────│
            │ │task_id    │ │──────────│ │──────────│ │──────────│ │id (PK)       │ │id (PK)       │
            │ │depends_on │ │id (PK)   │ │id (PK)   │ │id (PK)   │ │task_id       │ │task_id       │
            │ └───────────┘ │task_id   │ │task_id   │ │task_id   │ │project_id ───┼─► projects
            │               │phase_id  │ │content   │ │category  │ │agent_type    │ │title         │
            │               │type      │ │author    │ │type      │ │mode          │ │status        │
            │               │label     │ │created_at│ │summary   │ │status        │ │phase_order   │
            │               │url       │ └──────────┘ │data      │ │transcript    │ │branch_name   │
            │               │content   │              │actor_type│ │token_usage   │ │pr_url        │
            │               │file_path │              │level     │ │duration_ms   │ │created_at    │
            │               │metadata  │              │created_at│ │started_at    │ └──────────────┘
            │               │created_by│              └──────────┘ │finished_at   │
            │               │agent_run_id              │outcome    │
            │               │created_at│              └──────────────┘
            │               └──────────┘
            │
            │ 1:N
      ┌─────▼────────────┐      ┌────────────────┐      ┌────────────────┐
      │ activity_log     │      │ agent_queue     │      │ pending_prompts│
      │──────────────────│      │────────────────-│      │────────────────│
      │ id (PK)          │      │ id (PK)         │      │ id (PK)        │
      │ project_id ──────┼─►    │ project_id ─────┼─►    │ task_id        │
      │ type             │  projects │ task_id    │      │ type           │
      │ entity_type      │      │ agent_type      │      │ data           │
      │ entity_id        │      │ mode            │      │ status         │
      │ title            │      │ position        │      │ response       │
      │ metadata         │      │ status          │      │ timeout_at     │
      │ created_at       │      │ created_at      │      │ created_at     │
      └──────────────────┘      └─────────────────┘      │ responded_at   │
                                                         └────────────────┘

      ┌──────────────────┐
      │ transition_      │
      │ history          │
      │──────────────────│
      │ id (PK)          │
      │ task_id          │
      │ pipeline_id      │
      │ from_status      │
      │ to_status        │
      │ transition_id    │
      │ triggered_by     │
      │ agent_run_id     │
      │ reason           │
      │ guards_checked   │
      │ hooks_executed   │
      │ created_at       │
      └──────────────────┘
```

### Relationships Summary

| From | To | Cardinality | FK Column | On Delete |
|------|----|-------------|-----------|-----------|
| `tasks` | `projects` | N:1 | `tasks.project_id` | CASCADE |
| `tasks` | `pipelines` | N:1 | `tasks.pipeline_id` | (none) |
| `tasks` | `tasks` | N:1 (parent/child) | `tasks.parent_task_id` | SET NULL |
| `task_dependencies` | `tasks` | N:1 (both FKs) | `task_id`, `depends_on_task_id` | CASCADE |
| `task_phases` | `tasks` | N:1 | `task_phases.task_id` | CASCADE |
| `task_artifacts` | `tasks` | N:1 | `task_artifacts.task_id` | CASCADE |
| `task_artifacts` | `task_phases` | N:1 | `task_artifacts.phase_id` | SET NULL |
| `task_artifacts` | `agent_runs` | N:1 | `task_artifacts.agent_run_id` | (none) |
| `task_notes` | `tasks` | N:1 | `task_notes.task_id` | CASCADE |
| `task_events` | `tasks` | N:1 | `task_events.task_id` | (none) |
| `agent_runs` | `tasks` | N:1 | `agent_runs.task_id` | CASCADE |
| `agent_runs` | `projects` | N:1 | `agent_runs.project_id` | CASCADE |
| `activity_log` | `projects` | N:1 | `activity_log.project_id` | CASCADE |
| `agent_queue` | `projects` | N:1 | `agent_queue.project_id` | CASCADE |
| `agent_queue` | `tasks` | N:1 | `agent_queue.task_id` | CASCADE |

---

## Known Issues

### 1. Electron + better-sqlite3 Compatibility

Resolved in better-sqlite3 v12.6.x which includes C++20 fixes and ships prebuilt binaries for Electron 29-40+.

### 2. Native Module Version Mismatch

After switching Node versions (via nvm, fnm, etc.) or running `npm install`, better-sqlite3 may throw a `NODE_MODULE_VERSION` mismatch error at startup. Fix:

```bash
npx @electron/rebuild -f -w better-sqlite3
```

This is also configured as a postinstall script in `package.json`.

### 3. TypeScript Type Safety

`db.prepare().all()` returns `unknown[]`. Always cast results to a typed row interface. Never use `.map()` or property access on the raw return value without casting first.

```typescript
// Wrong -- TypeScript error
const names = db.prepare('SELECT name FROM projects').all().map(r => r.name);

// Right -- cast first
const rows = db.prepare('SELECT name FROM projects').all() as { name: string }[];
const names = rows.map(r => r.name);
```

### 4. `crypto.randomUUID()` Not Available in Main Process

Use the Node.js import instead:

```typescript
import { randomUUID } from 'crypto';
const id = randomUUID();
```

The template provides a `generateId()` helper in `template/main/services/database.ts`.

---

## Cross-References

- **[overview.md](overview.md)** -- Interface definitions (`ITaskStore`, `IProjectStore`, etc.), dependency injection, composition root
- **[projects.md](projects.md)** -- Project data model, path management, project-level configuration
- **[pipeline/json-contract.md](pipeline/json-contract.md)** -- Pipeline definition JSON schema (stored in `pipelines.definition`)
- **[pipeline/event-log.md](pipeline/event-log.md)** -- Task event log schema and usage patterns
- **[notification-system.md](notification-system.md)** -- Pending prompts lifecycle
