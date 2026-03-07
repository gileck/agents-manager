---
title: Data Layer
description: SQLite schema, stores, and migrations
summary: "better-sqlite3 with WAL mode. Daemon is the sole DB owner via src/core/db.ts. DB path resolves from AM_DB_PATH env or ~/Library/Application Support/agents-manager/agents-manager.db. Fresh databases apply baseline schema from src/core/schema.ts; existing databases run incremental migrations from src/core/migrations.ts."
priority: 3
key_points:
  - "All stores are in src/core/stores/ — task-store, project-store, pipeline-store, etc."
  - "Baseline schema: src/core/schema.ts — applied to fresh databases. Incremental migrations: src/core/migrations.ts"
  - "Cast db.prepare().all() results: as { field: type }[]"
  - "PRAGMA foreign_keys = ON — all FK constraints are enforced. Synthetic/virtual IDs will fail on FK-constrained columns. Check the FK table in data-layer.md before inserting into any table with foreign keys."
---
# Data Layer

SQLite schema, stores, and migrations.

## Database Setup

**Library:** better-sqlite3 (synchronous SQLite binding for Node.js)

**Path resolution (in order):**
1. `AM_DB_PATH` environment variable
2. Default: `~/Library/Application Support/agents-manager/agents-manager.db`

**Pragmas:**
```sql
PRAGMA journal_mode = WAL;    -- Write-Ahead Logging for concurrent access
PRAGMA foreign_keys = ON;     -- Enforce referential integrity
```

The daemon is the sole database owner. WAL mode is still enabled for safe concurrent reads within the daemon process.

## Table Inventory

**File:** `src/core/schema.ts` — baseline schema for all tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `projects` | Project records | id, name, description, path, config (JSON) |
| `tasks` | Core task records (26 columns) | id, projectId, pipelineId, title, status, priority, tags (JSON), subtasks (JSON), plan, planComments (JSON), featureId, metadata (JSON) |
| `task_dependencies` | Dependency graph | task_id, depends_on_task_id (composite PK) |
| `pipelines` | Status machine definitions | id, name, statuses (JSON), transitions (JSON), task_type (UNIQUE) |
| `transition_history` | Transition audit trail | id, taskId, fromStatus, toStatus, trigger, actor, guardResults (JSON) |
| `task_events` | Granular event log | id, taskId, category, severity, message, data (JSON) |
| `activity_log` | Cross-entity action log | id, action, entityType, entityId, projectId, summary, data (JSON) |
| `agent_runs` | Agent execution records | id, taskId, agentType, mode, status, output, outcome, payload (JSON), exitCode, costInputTokens, costOutputTokens, prompt |
| `task_artifacts` | Artifact storage | id, taskId, type (CHECK), data (JSON) |
| `task_phases` | Phase tracking | id, taskId, phase, status, agentRunId (FK) |
| `pending_prompts` | Human interaction queue | id, taskId, agentRunId (FK), promptType, payload (JSON), response (JSON), resumeOutcome, status |
| `task_context_entries` | Accumulated agent knowledge | id, taskId, agentRunId, source, entryType, summary, data (JSON), addressed |
| `features` | Feature/epic grouping | id, projectId (FK), title, description |
| `agent_definitions` | Agent configurations | id, name, engine, model, modes (JSON), systemPrompt, timeout, isBuiltIn, skills (JSON) |
| `settings` | Key-value settings | key (PK), value |
| `users` | User profiles | id, username, role |
| `kanban_boards` | Kanban board configurations | id, projectId (FK), name, columns (JSON) |
| `chat_sessions` | Chat sessions (project or task scoped) | id, projectId, scopeType, scopeId, name, agentLib, source, agentRunId |
| `chat_messages` | Chat messages per session | id, sessionId, role, content, costInputTokens, costOutputTokens |
| `app_debug_log` | Application debug log | id, level, source, message, data (JSON) |
| `automated_agents` | Automated agent configurations | id, projectId (FK), name, promptInstructions, capabilities (JSON), schedule (JSON), enabled |

## Store Pattern

Each table has a corresponding store class following a consistent pattern:

**File naming:** `src/core/stores/sqlite-{entity}.ts`
**Interface:** `src/core/interfaces/{entity}.ts`

### Pattern

1. **Row interface** — maps database columns (snake_case)
2. **Conversion function** — `rowToEntity(row: EntityRow): Entity` using `parseJson()` for JSON fields
3. **Store class** — implements typed interface, takes `Database` constructor argument
4. **CRUD methods** — parameterized queries with `?` placeholders

### Store Files

| Store File | Interface | Table |
|-----------|-----------|-------|
| `sqlite-project-store.ts` | `IProjectStore` | projects |
| `sqlite-task-store.ts` | `ITaskStore` | tasks |
| `sqlite-pipeline-store.ts` | `IPipelineStore` | pipelines |
| `sqlite-agent-run-store.ts` | `IAgentRunStore` | agent_runs |
| `sqlite-task-artifact-store.ts` | `ITaskArtifactStore` | task_artifacts |
| `sqlite-task-phase-store.ts` | `ITaskPhaseStore` | task_phases |
| `sqlite-pending-prompt-store.ts` | `IPendingPromptStore` | pending_prompts |
| `sqlite-task-event-log.ts` | `ITaskEventLog` | task_events |
| `sqlite-activity-log.ts` | `IActivityLog` | activity_log |
| `sqlite-task-context-store.ts` | `ITaskContextStore` | task_context_entries |
| `sqlite-feature-store.ts` | `IFeatureStore` | features |
| `sqlite-agent-definition-store.ts` | `IAgentDefinitionStore` | agent_definitions |
| `sqlite-kanban-board-store.ts` | `IKanbanBoardStore` | kanban_boards |
| `sqlite-user-store.ts` | `IUserStore` | users |
| `sqlite-chat-session-store.ts` | `IChatSessionStore` | chat_sessions |
| `sqlite-chat-message-store.ts` | `IChatMessageStore` | chat_messages |

### Selective Updates

Stores like `sqlite-task-store.ts` and `sqlite-project-store.ts` use selective UPDATE patterns — only fields present in the input are included in the SET clause. This prevents accidentally nullifying unset fields.

## Migration System

The schema uses a **baseline + incremental** approach:

- **Fresh database** (no `migrations` table): applies the baseline schema from `src/core/schema.ts`, then records all baseline migration names as applied, then runs any post-baseline incremental migrations from `src/core/migrations.ts`.
- **Existing database** (has `migrations` table): runs only pending incremental migrations from `src/core/migrations.ts`.

Detection logic lives in `src/core/db.ts` → `runMigrations()`.

### Adding New Migrations

Append new migration entries to the `getMigrations()` array in `src/core/migrations.ts`. Number them starting from 088. Each migration is a `{ name, sql }` object that runs sequentially on startup.

### Folding Migrations into the Baseline

Periodically, incremental migrations can be folded into the baseline:
1. Update `src/core/schema.ts` — modify `getBaselineSchema()` to reflect the new final state
2. Add the migration names to `BASELINE_MIGRATION_NAMES`
3. Remove the folded entries from `getMigrations()` in `src/core/migrations.ts`

### Schema Evolution Patterns

**`ALTER TABLE ADD COLUMN`** — used for simple additions:
```sql
ALTER TABLE tasks ADD COLUMN feature_id TEXT REFERENCES features(id);
ALTER TABLE activity_log ADD COLUMN project_id TEXT;
```

**Full table rebuild** — required for CHECK constraint changes (SQLite doesn't support `ALTER TABLE MODIFY COLUMN`):

1. Create temporary tables without foreign keys pointing to the target
2. Copy data from the target table to temp
3. Drop the original target table
4. Recreate the target table with updated CHECK constraints
5. Copy data back from temp
6. Drop temp tables
7. Recreate indexes

This pattern is used when adding new enum values (e.g., widening the agent_runs.mode CHECK constraint to accept `'new'` and `'revision'`).

## JSON Storage Convention

### Utility: `parseJson()`

**File:** `src/core/stores/utils.ts`

```typescript
function parseJson<T>(raw: string | null | undefined, fallback: T): T
```

Safely parses JSON or returns the fallback value. Used on every JSON column read to prevent errors from null or corrupted data.

### JSON Columns

**JSON objects:**
- `projects.config` — e.g., `{ pullMainAfterMerge: true, defaultBranch: "main" }`
- `tasks.metadata` — free-form extension data

**JSON arrays:**
- `tasks.tags` — `["feature", "urgent"]`
- `tasks.subtasks` — `[{ name: "Step 1", status: "open" }]`
- `tasks.plan_comments` — `[{ author: "admin", content: "...", createdAt: 123 }]`
- `pipelines.statuses` — `[{ name: "open", label: "Open", color: "gray", isFinal: false }]`
- `pipelines.transitions` — full transition definitions with guards and hooks
- `agent_definitions.modes` — `[{ mode: "plan", promptTemplate: "...", timeout: 300000 }]`

**JSON payloads:**
- `agent_runs.payload` — outcome-specific data
- `task_artifacts.data` — type-specific data (PR info, diff content, etc.)
- `pending_prompts.payload` / `response` — prompt input/output
- `task_context_entries.data` — context entry metadata
- `task_events.data` / `activity_log.data` — event metadata
- `transition_history.guard_results` — guard evaluation results

All JSON fields are serialized with `JSON.stringify()` on write and parsed with `parseJson()` on read.

## Seeded Data

### Pipeline

Source: `src/core/data/seeded-pipelines.ts` — `SEEDED_PIPELINES` array. Seeded via `src/core/schema.ts`.

One pipeline:
- `pipeline-agent` (task type: `agent`) — Agent-driven workflow with investigation, design, plan, implement, and review phases

See [pipeline-engine.md](./pipeline-engine.md) for full pipeline definition.

### Agent Definitions

Seeded via `src/core/schema.ts`. Built-in agent definitions (`is_built_in = 1`, prevents deletion):
- `agent-def-planner` — Planner agent
- `agent-def-designer` — Designer agent
- `agent-def-implementor` — Implementor agent
- `agent-def-investigator` — Investigator agent
- `agent-def-reviewer` — PR reviewer agent
- `agent-def-task-workflow-reviewer` — Task workflow reviewer

External agent definitions (`is_built_in = 0`):
- `agent-def-cursor-agent` — Cursor CLI agent
- `agent-def-codex-cli` — OpenAI Codex CLI agent

### Settings

Seeded via `src/core/schema.ts`:
- `theme: 'dark'`
- `notifications_enabled: 'true'`
- `default_pipeline_id: 'pipeline-agent'`
- `chat_default_agent_lib: 'claude-code'`

### Users

Seeded via `src/core/schema.ts`:
- `user-admin` — default admin user (role: `admin`)

## Foreign Key Constraints

`PRAGMA foreign_keys = ON` is set at connection time — all FK constraints are **enforced at runtime**. Any INSERT or UPDATE that references a non-existent parent row will throw `FOREIGN KEY constraint failed`.

**When adding new features that insert into FK-constrained tables, verify the referenced row exists or the FK has been removed.** Synthetic/virtual IDs (e.g., `__auto__:xyz`) will fail if the column has a FK constraint to another table.

| Child Table | Column | References | ON DELETE |
|---|---|---|---|
| `tasks` | `project_id` | `projects(id)` | — |
| `tasks` | `pipeline_id` | `pipelines(id)` | — |
| `tasks` | `parent_task_id` | `tasks(id)` | — |
| `tasks` | `feature_id` | `features(id)` | — |
| `task_dependencies` | `task_id` | `tasks(id)` | — |
| `task_dependencies` | `depends_on_task_id` | `tasks(id)` | — |
| `task_events` | `task_id` | `tasks(id)` | — |
| `transition_history` | `task_id` | `tasks(id)` | — |
| `task_artifacts` | `task_id` | `tasks(id)` | — |
| `task_phases` | `task_id` | `tasks(id)` | — |
| `task_phases` | `agent_run_id` | `agent_runs(id)` | — |
| `pending_prompts` | `task_id` | `tasks(id)` | — |
| `pending_prompts` | `agent_run_id` | `agent_runs(id)` | — |
| `task_context_entries` | `task_id` | `tasks(id)` | — |
| `features` | `project_id` | `projects(id)` | — |
| `kanban_boards` | `project_id` | `projects(id)` | CASCADE |
| `automated_agents` | `project_id` | `projects(id)` | CASCADE |

**Notable:** `agent_runs.task_id` does **not** have a FK constraint — intentionally dropped to allow automated agent runs with synthetic task IDs. `chat_messages.session_id` also has no FK constraint.

## Edge Cases

- **Sync transactions** protect against TOCTOU: the pipeline engine re-fetches the task inside a `db.transaction()` callback before checking guards and updating status.
- **CHECK constraint widening** requires full table rebuilds because SQLite doesn't support modifying CHECK constraints in place.
- **The daemon is the sole DB owner** — Electron and CLI connect via HTTP, not direct DB access.
- **DB is opened via `src/core/db.ts`** which handles path resolution, pragma setup, and baseline/migration execution.
- **`parseJson()` never throws** — it catches parse errors and returns the fallback value. This makes JSON column reads safe even with corrupted data.
- **Migration idempotency** — the `migrations` table with UNIQUE name constraint prevents re-running applied migrations. Fresh databases record all baseline migration names to prevent incremental migrations from re-applying.
- **Foreign keys** are enabled via pragma. Cascade behavior varies: some tables use ON DELETE CASCADE, others handle cascades in application code (e.g., `resetTask` manually deletes related rows).
