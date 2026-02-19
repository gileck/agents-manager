# Data Layer

SQLite schema, stores, and migrations.

## Database Setup

**Library:** better-sqlite3 (synchronous SQLite binding for Node.js)

**Path resolution (in order):**
1. Explicit `--db` flag (CLI only)
2. `AM_DB_PATH` environment variable
3. Default: `~/Library/Application Support/agents-manager/agents-manager.db`

**Pragmas:**
```sql
PRAGMA journal_mode = WAL;    -- Write-Ahead Logging for concurrent access
PRAGMA foreign_keys = ON;     -- Enforce referential integrity
```

WAL mode allows the CLI and Electron app to access the database concurrently without locking conflicts.

## Table Inventory

**File:** `src/main/migrations.ts` — 40+ sequential migrations

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
| `task_context_entries` | Accumulated agent knowledge | id, taskId, agentRunId, source, entryType, summary, data (JSON) |
| `features` | Feature/epic grouping | id, projectId (FK), title, description |
| `agent_definitions` | Agent configurations | id, name, engine, model, modes (JSON), systemPrompt, timeout, isBuiltIn |
| `settings` | Key-value settings | key (PK), value |
| `items` | Template items | id, name, description |
| `logs` | Legacy log records | id, runId, timestamp, level, message |

## Store Pattern

Each table has a corresponding store class following a consistent pattern:

**File naming:** `src/main/stores/sqlite-{entity}.ts`
**Interface:** `src/main/interfaces/{entity}.ts`

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

### Selective Updates

Stores like `sqlite-task-store.ts` and `sqlite-project-store.ts` use selective UPDATE patterns — only fields present in the input are included in the SET clause. This prevents accidentally nullifying unset fields.

## Migration System

Migrations are defined as an array of `{ name, sql }` objects in `src/main/migrations.ts`. They run sequentially on startup.

**Execution:**
1. Create `migrations` table if not exists (name TEXT UNIQUE)
2. Query already-applied migrations
3. For each unapplied migration: execute SQL in a transaction, record the migration name

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

This pattern is used when adding new enum values (e.g., adding `request_changes`, `plan_revision`, `investigate` to agent_runs.mode CHECK constraint).

### Key Indexes

**Phase 1 (migration 012) — 13 indexes:**
- `tasks`: projectId, pipelineId, status, priority, parentTaskId, featureId
- `task_events`: taskId + createdAt, category
- `transition_history`: taskId + createdAt
- `activity_log`: entityType + entityId, action + createdAt

**Phase 2 (migration 017) — 5 indexes:**
- `agent_runs`: taskId + startedAt, status
- `task_artifacts`: taskId + type
- `task_phases`: taskId
- `pending_prompts`: taskId + status

## JSON Storage Convention

### Utility: `parseJson()`

**File:** `src/main/stores/utils.ts`

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

### Pipelines (migration 011)

Source: `src/main/data/seeded-pipelines.ts` — `SEEDED_PIPELINES` array

Uses `INSERT OR IGNORE` to seed 5 pipelines:
- `pipeline-simple` (task type: `simple`)
- `pipeline-feature` (task type: `feature`)
- `pipeline-bug` (task type: `bug`)
- `pipeline-agent` (task type: `agent`)
- `pipeline-bug-agent` (task type: `bug-agent`)

See [pipeline-engine.md](./pipeline-engine.md) for full pipeline definitions.

### Agent Definitions (migration 028)

Seeds 2 built-in agent definitions:
- `agent-def-claude-code` — ClaudeCodeAgent configuration
- `agent-def-pr-reviewer` — PrReviewerAgent configuration

Each has `is_built_in = 1` (prevents deletion).

### Settings (migration 035)

Seeds default settings:
- `theme: 'system'`
- `notifications_enabled: 'true'`
- `bug_pipeline_id: 'pipeline-bug-agent'`

## Edge Cases

- **Sync transactions** protect against TOCTOU: the pipeline engine re-fetches the task inside a `db.transaction()` callback before checking guards and updating status.
- **CHECK constraint widening** requires full table rebuilds because SQLite doesn't support modifying CHECK constraints in place. Three migrations (023, 030, 037) use this pattern.
- **Concurrent CLI + Electron** access is safe via WAL mode. Both open the same database file with WAL enabled.
- **`parseJson()` never throws** — it catches parse errors and returns the fallback value. This makes JSON column reads safe even with corrupted data.
- **Migration idempotency** — the `migrations` table with UNIQUE name constraint prevents re-running applied migrations.
- **Foreign keys** are enabled via pragma. Cascade behavior varies: some tables use ON DELETE CASCADE, others handle cascades in application code (e.g., `resetTask` manually deletes related rows).
