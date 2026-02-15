# Tasks

The authoritative reference for the **Task** entity in Agents Manager. A task is the core unit of work that flows through a pipeline, gets assigned to agents, accumulates artifacts, and tracks all activity.

See also: [pipeline/index.md](pipeline/index.md) (status and transitions) | [pipeline/event-log.md](pipeline/event-log.md) (task event log) | [agent-platform.md](agent-platform.md) (how agents work on tasks) | [workflow-service.md](workflow-service.md) (single entry point for all operations) | [overview.md](overview.md) (abstraction layers and interfaces)

---

## Overview

A **task** represents a discrete piece of work within a project. Tasks are the central entity that everything else revolves around:

- **Pipeline integration** -- Each task is assigned a pipeline (state machine) that defines its valid statuses and transitions. Status is a dynamic string defined by the pipeline, never a hardcoded enum.
- **Agent execution** -- Agents (Claude Code, Cursor, Aider, etc.) are run against tasks. The agent receives the task's metadata, plan, and event history as context.
- **Artifact accumulation** -- As work progresses, tasks accumulate first-class artifacts: branches, pull requests, commits, diffs, and links.
- **Dependency tracking** -- Tasks can depend on other tasks. Pipeline guards use dependencies to block transitions (e.g., a task cannot start until its dependencies are resolved).
- **Subtask hierarchy** -- Tasks can have child tasks via `parentTaskId`. Subtasks appear nested under their parent in the UI.
- **Notes and commentary** -- Users and agents can add chronological notes to a task, separate from the automatic event log.
- **Plan field** -- A dedicated markdown field populated by the plan-mode agent, editable by the user, and injected into agent context when running implement mode.

Tasks flow through their lifecycle exclusively via the pipeline engine. Status changes are never made directly -- they always go through `WorkflowService.transitionTask()`, which validates guards, fires hooks, logs events, and sends notifications.

---

## Data Model

```typescript
// src/shared/types.ts

/**
 * Status is a string, NOT an enum.
 * It comes from the pipeline definition assigned to the task.
 * Examples: 'open', 'planning', 'in_progress', 'pr_review', 'done'
 */
type TaskStatus = string;

/** Task priority levels, ordered from most to least urgent. */
type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

/** T-shirt sizing for estimated effort. */
type TaskSize = 'xs' | 's' | 'm' | 'l' | 'xl';

/** How difficult the task is expected to be. */
type TaskComplexity = 'low' | 'medium' | 'high';

/**
 * The core task entity.
 *
 * A unit of work that flows through a pipeline, gets worked on by agents,
 * and accumulates artifacts over its lifecycle.
 */
interface Task {
  /** Unique identifier (UUID v4). */
  id: string;

  /** FK -> projects.id. The project this task belongs to. */
  projectId: string;

  /** Short human-readable title. */
  title: string;

  /** Full description in markdown. Rendered in the task detail page. */
  description: string;

  /**
   * Current status ID, defined by the pipeline.
   * This is a dynamic string (e.g., 'open', 'in_progress', 'pr_review'),
   * NOT a TypeScript enum. Valid values come from the pipeline definition.
   * Never changed directly -- always through the pipeline engine via
   * WorkflowService.transitionTask().
   */
  status: TaskStatus;

  /**
   * FK -> pipelines.id. Which pipeline (state machine) this task uses.
   * Determines valid statuses, transitions, guards, and hooks.
   * Default: 'simple'. Can be 'bug', 'feature', 'chore', or a custom pipeline.
   */
  pipelineId: string;

  /** Priority level. Default: 'medium'. */
  priority: TaskPriority;

  /** T-shirt size estimate. Default: 'm'. */
  size: TaskSize;

  /** Expected complexity. Default: 'medium'. */
  complexity: TaskComplexity;

  /** Freeform tags for categorization and filtering. Stored as JSON array. */
  tags: string[];

  /**
   * Implementation plan in markdown.
   * Populated by the plan-mode agent, editable by the user before running
   * the implement agent. Injected into agent context by AgentContextBuilder.
   */
  plan: string | null;

  /**
   * FK -> tasks.id. If set, this task is a subtask of the parent.
   * Subtasks appear nested under their parent in the UI.
   */
  parentTaskId: string | null;

  /** Display order within a status column on the kanban board. */
  sortOrder: number;

  /** ISO 8601 timestamp. Set once at creation. */
  createdAt: string;

  /** ISO 8601 timestamp. Updated on every change. */
  updatedAt: string;

  // --- Joined / computed fields (populated by getTask, not stored directly) ---

  /** Tasks that this task depends on. Populated when fetching a single task. */
  dependencies?: Task[];

  /** Child tasks. Populated when fetching a single task. */
  subtasks?: Task[];
}
```

### Supporting Types

```typescript
/**
 * Input for creating a new task.
 * Only title and projectId are required. Everything else has sensible defaults.
 */
interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  status?: TaskStatus;        // default: pipeline's initialStatus (usually 'open')
  priority?: TaskPriority;    // default: 'medium'
  size?: TaskSize;            // default: 'm'
  complexity?: TaskComplexity; // default: 'medium'
  tags?: string[];
  parentTaskId?: string;
  pipelineId?: string;        // default: project's default pipeline
}

/**
 * Input for updating an existing task.
 * All fields are optional -- only provided fields are changed.
 */
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

---

## Task Store Interface (`ITaskStore`)

The primary data access interface for tasks. Phase 1 implementation is `SqliteTaskStore`. Future implementations could target Linear, Jira, GitHub Projects, or Notion.

All methods return `Promise` -- even if the current implementation (SQLite) is synchronous -- to support future migration to async backends without refactoring callers.

```typescript
// src/main/interfaces/task-store.ts

interface ITaskStore {
  // ─── Task CRUD ─────────────────────────────────────────────────────

  /**
   * List tasks for a project, optionally filtered.
   * Returns tasks sorted by sortOrder within each status group.
   */
  listTasks(projectId: string, filters?: TaskFilters): Promise<Task[]>;

  /**
   * Get a single task by ID.
   * Returns null if not found.
   * When fetched individually, includes joined dependencies and subtasks.
   */
  getTask(id: string): Promise<Task | null>;

  /**
   * Create a new task. Generates a UUID, sets createdAt/updatedAt,
   * assigns the pipeline's initialStatus if status is not provided.
   */
  createTask(data: CreateTaskInput): Promise<Task>;

  /**
   * Update an existing task. Only provided fields are changed.
   * Updates the updatedAt timestamp.
   */
  updateTask(id: string, data: UpdateTaskInput): Promise<Task>;

  /**
   * Delete a task and all associated data (dependencies, notes, artifacts).
   * Cascade delete via FK constraints.
   */
  deleteTask(id: string): Promise<void>;

  // ─── Reorder ───────────────────────────────────────────────────────

  /**
   * Move a task to a new position within a status column.
   * Used by kanban board drag-and-drop within the same column.
   */
  reorderTask(id: string, status: TaskStatus, sortOrder: number): Promise<void>;

  // ─── Dependencies ──────────────────────────────────────────────────

  /**
   * Add a dependency: taskId depends on dependsOnTaskId.
   * The task cannot proceed past guards that check dependencies_resolved
   * until dependsOnTaskId reaches a terminal status.
   */
  addDependency(taskId: string, dependsOnTaskId: string): Promise<void>;

  /**
   * Remove a dependency relationship.
   */
  removeDependency(taskId: string, dependsOnTaskId: string): Promise<void>;

  /**
   * Get tasks that this task depends ON (blocking tasks).
   * If task A depends on task B, getDependencies(A) returns [B].
   */
  getDependencies(taskId: string): Promise<Task[]>;

  /**
   * Get tasks that depend on THIS task (tasks blocked by this one).
   * If task A depends on task B, getDependents(B) returns [A].
   */
  getDependents(taskId: string): Promise<Task[]>;

  // ─── Subtasks ──────────────────────────────────────────────────────

  /**
   * Get all direct child tasks of a parent task.
   */
  getSubtasks(parentTaskId: string): Promise<Task[]>;

  // ─── Bulk Operations ───────────────────────────────────────────────

  /**
   * Update the status of multiple tasks at once.
   * Used by bulk action bar in the task list view.
   * Note: this bypasses pipeline guards -- use with caution.
   */
  bulkUpdateStatus(taskIds: string[], status: TaskStatus): Promise<void>;

  /**
   * Delete multiple tasks at once.
   */
  bulkDelete(taskIds: string[]): Promise<void>;

  // ─── Notes ─────────────────────────────────────────────────────────

  /**
   * List all notes for a task, ordered chronologically (oldest first).
   */
  listNotes(taskId: string): Promise<TaskNote[]>;

  /**
   * Add a note to a task.
   * @param author - 'user' for human-added notes, or agent type name (e.g., 'claude-code')
   */
  addNote(taskId: string, content: string, author: string): Promise<TaskNote>;

  /**
   * Delete a specific note.
   */
  deleteNote(noteId: string): Promise<void>;

  // ─── Artifacts ─────────────────────────────────────────────────────

  /**
   * Add an artifact to a task.
   * Artifacts are first-class data that accumulates over the task lifecycle.
   */
  addArtifact(taskId: string, artifact: CreateArtifactInput): Promise<TaskArtifact>;

  /**
   * List all artifacts for a task, optionally filtered by type.
   */
  listArtifacts(taskId: string, type?: string): Promise<TaskArtifact[]>;

  /**
   * Get a single artifact by ID.
   */
  getArtifact(artifactId: string): Promise<TaskArtifact | null>;

  /**
   * Update an artifact (e.g., update PR state from 'open' to 'merged').
   */
  updateArtifact(artifactId: string, data: Partial<TaskArtifact>): Promise<TaskArtifact>;

  /**
   * Remove an artifact from a task.
   */
  removeArtifact(artifactId: string): Promise<void>;
}
```

---

## Task Filters

Filters are used by `listTasks()` and the UI filter bar. All fields are optional -- only provided filters are applied.

```typescript
interface TaskFilters {
  /** Filter by one or more statuses. Values are pipeline-defined status IDs. */
  status?: string[];

  /** Filter by priority levels. */
  priority?: ('critical' | 'high' | 'medium' | 'low')[];

  /** Filter by size. */
  size?: ('xs' | 's' | 'm' | 'l' | 'xl')[];

  /** Filter by complexity. */
  complexity?: ('simple' | 'moderate' | 'complex')[];

  /** Filter by tags. A task matches if it has ANY of the specified tags. */
  tags?: string[];

  /**
   * Full-text search across title and description.
   * Case-insensitive substring match.
   */
  search?: string;

  /**
   * Filter by parent task.
   * - Set to a task ID to get subtasks of that parent.
   * - Set to null to get only top-level tasks (no parent).
   * - Omit entirely to get all tasks regardless of hierarchy.
   */
  parentTaskId?: string | null;
}
```

---

## Dependencies

Tasks can depend on other tasks. Dependencies are stored in a junction table and used by pipeline guards to enforce ordering.

### How Dependencies Work

- A dependency means "task A cannot proceed until task B is done."
- The `dependencies_resolved` pipeline guard checks whether all tasks in `getDependencies(taskId)` are in a terminal status (as defined by their pipeline).
- If any dependency is not resolved, transitions that require `dependencies_resolved` are blocked. The UI shows the button as disabled with a tooltip explaining which dependencies are unmet.
- `getDependencies(taskId)` returns the tasks that `taskId` depends ON (the blocking tasks).
- `getDependents(taskId)` returns the tasks that depend on `taskId` (the tasks this one blocks).

### Circular Dependency Prevention

The store implementation should check for circular dependencies when adding a new dependency. If adding A -> B would create a cycle (e.g., B already depends on A, directly or transitively), the operation should be rejected.

### Example

```typescript
// Task "Add auth" depends on "Set up database schema"
await taskStore.addDependency('task-auth-id', 'task-db-schema-id');

// What does "Add auth" depend on?
const deps = await taskStore.getDependencies('task-auth-id');
// => [{ id: 'task-db-schema-id', title: 'Set up database schema', status: 'open', ... }]

// What depends on "Set up database schema"?
const dependents = await taskStore.getDependents('task-db-schema-id');
// => [{ id: 'task-auth-id', title: 'Add auth', status: 'open', ... }]

// Pipeline guard usage (in CoreHandler):
async dependenciesResolved(task: Task, ctx: PipelineContext): Promise<boolean> {
  const deps = await this.taskStore.getDependencies(task.id);
  return deps.every(d => ctx.pipelineEngine.isTerminal(d.pipelineId, d.status));
}
```

---

## Subtasks

Tasks can have child tasks via the `parentTaskId` field.

### How Subtasks Work

- A subtask is a regular task with its `parentTaskId` set to the parent task's ID.
- Subtasks appear nested under their parent in the UI (task detail page, task list).
- Subtask completion does **not** automatically affect the parent task's status. The parent task transitions independently through its own pipeline.
- Subtasks can have their own pipeline, priority, size, and all other task fields.
- Subtasks cannot themselves have subtasks (single level of nesting).
- When a parent task is deleted, subtasks have their `parentTaskId` set to NULL (via `ON DELETE SET NULL`), becoming top-level tasks.

### Filtering

Use `TaskFilters.parentTaskId` to control hierarchy in list views:

```typescript
// Get only top-level tasks (no parent)
const topLevel = await taskStore.listTasks(projectId, { parentTaskId: null });

// Get subtasks of a specific parent
const subtasks = await taskStore.getSubtasks('parent-task-id');
// or equivalently:
const subtasks = await taskStore.listTasks(projectId, { parentTaskId: 'parent-task-id' });
```

---

## Task Notes

Chronological notes and comments on a task. Notes are deliberate commentary added by users or agents, distinct from the automatic event log.

### Data Model

```typescript
interface TaskNote {
  /** Unique identifier (UUID v4). */
  id: string;

  /** FK -> tasks.id. */
  taskId: string;

  /** Note content. Plain text or markdown. */
  content: string;

  /**
   * Who added this note.
   * 'user' for human-added notes, or the agent type name (e.g., 'claude-code')
   * for agent-added notes.
   */
  author: string;

  /** ISO 8601 timestamp. */
  createdAt: string;
}
```

### Notes vs Event Log

| | Notes | Event Log |
|---|---|---|
| **Purpose** | Deliberate commentary | Automatic system record |
| **Created by** | User action or agent decision | Pipeline engine, services, hooks |
| **Content** | Free-form text | Structured events with categories |
| **Use case** | "Check the auth middleware first" | "Status: open -> in_progress (by user)" |
| **Editable** | No (append-only) | No |
| **Visible to agents** | Via AgentContextBuilder (future) | Via event log queries |

### Interface

Notes are managed through `ITaskStore`:

```typescript
// List all notes for a task, oldest first
const notes = await taskStore.listNotes(taskId);

// Add a note (from user)
const note = await taskStore.addNote(taskId, 'Check the auth middleware first', 'user');

// Add a note (from agent)
const note = await taskStore.addNote(taskId, 'Found 3 potential approaches', 'claude-code');

// Delete a note
await taskStore.deleteNote(noteId);
```

---

## Task Phases

A task can optionally be broken into **phases** — ordered chunks of work that each get their own branch, PR, agent runs, and artifacts. Phases are useful when a task is too large for a single PR or when different parts of the work should land independently.

### When To Use Phases

- **Single-phase tasks (default):** Most tasks don't need phases. One branch, one PR, done. Artifacts attach directly to the task with `phaseId: null`. The agent branches from `main` and PRs back to `main`.
- **Multi-phase tasks:** Large features that span backend + frontend + tests, or tasks where you want separate PRs for reviewability. Each phase gets its own branch and PR, all coordinated through a task-level integration branch.

### Examples

```
Task: "Add user authentication"
  Phase 1: Backend API        → branch, PR → merge to task branch, 12 commits
  Phase 2: Frontend UI        → branch, PR → merge to task branch, 8 commits
  Phase 3: E2E Tests          → branch, PR → merge to task branch, 3 commits
  Final:                      → task branch PR → merge to main
```

```
Task: "Migrate database from MySQL to Postgres"
  Phase 1: Schema migration   → branch, PR → merge to task branch, design doc
  Phase 2: Data migration     → branch, PR → merge to task branch, migration script
  Phase 3: App code changes   → branch, PR → merge to task branch
  Phase 4: Cleanup old code   → branch, PR → merge to task branch
  Final:                      → task branch PR → merge to main
```

### Branching Strategy

Multi-phase tasks use a **task branch as integration branch**. Phase branches are created from and merged back into the task branch. A final PR merges the task branch into `main`.

```
main ──────────────────────────────────────────────────────────── ...
  │
  └── agents-manager/add-auth-abc123  (task branch, created when first phase starts)
        │
        ├── agents-manager/add-auth-abc123/backend   (phase 1 branch)
        │     → commits → PR #41 → merge to task branch
        │
        ├── agents-manager/add-auth-abc123/frontend  (phase 2 branch)
        │     → commits → PR #42 → merge to task branch
        │
        └── agents-manager/add-auth-abc123/tests     (phase 3 branch)
              → commits → PR #43 → merge to task branch
                                          │
                                          └── PR #44: task branch → main (final PR)
```

**Branch naming:**
- Task branch: `<prefix>/<task-slug>-<task-id-short>` (e.g., `agents-manager/add-auth-abc123`)
- Phase branch: `<task-branch>/<phase-slug>` (e.g., `agents-manager/add-auth-abc123/backend`)

**Single-phase tasks** skip the task branch entirely — they branch directly from `main` and PR directly to `main`, same as today.

**Key rules:**
- Phase branches are created from the task branch, not from `main`
- Phase PRs merge into the task branch, not into `main`
- Later phases see all code from earlier merged phases (because they branch from the task branch)
- The final PR from task branch → `main` shows the complete feature
- The task is only "done" when the final PR merges to `main`

### Ownership Across Layers

Phases are a cross-cutting concern. Each layer owns a specific part:

| Layer | Responsibility |
|-------|---------------|
| **Task schema** | Stores phases, their status/order, and which artifacts belong to which phase |
| **Pipeline** | Orchestrates phase progression — guards, hooks, phase transitions, final PR |
| **Agent platform** | Runs agents against a specific phase, scopes artifacts, assembles phase-aware context |
| **Git/SCM** | Creates task branch, phase branches, phase PRs (to task branch), final PR (to main) |

### Pipeline Integration

The pipeline drives phase lifecycle through guards and hooks.

**Phase-aware guards:**

| Guard | Checks | Used On |
|-------|--------|---------|
| `current_phase_has_pr` | The active phase has a `pull_request` artifact with `state: 'open'` | phase_review transitions |
| `current_phase_pr_merged` | The active phase's PR has been merged to the task branch | advance-to-next-phase transitions |
| `all_phases_completed` | Every phase has `status: 'completed'` | final PR creation |
| `has_final_pr` | A task-level (no phase) `pull_request` artifact exists for task branch → main | task completion |

**Phase-aware hooks:**

| Hook | Action | Triggered By |
|------|--------|-------------|
| `start_phase_agent` | Starts agent for the current phase — creates phase branch from task branch, runs agent | Phase enters `in_progress` |
| `merge_phase_pr` | Merges phase PR into task branch, marks phase as `completed` | Phase PR approved |
| `advance_phase` | Sets next phase to `in_progress` (or creates final PR if last phase) | Current phase completed |
| `create_task_branch` | Creates the task integration branch from `main` | First phase starts (one-time) |
| `create_final_pr` | Creates PR from task branch → `main` | All phases completed |
| `merge_final_pr` | Merges the final PR to `main`, transitions task to `done` | Final PR approved |

**Example pipeline flow for a multi-phase task:**

```
open → planning → planned → in_progress (phase 1 starts)
                                 │
                  ┌──────────────┘
                  ▼
            phase 1 agent runs → phase 1 PR created
                  │
                  ▼
            phase 1 PR merged to task branch → phase 1 completed
                  │
                  ▼
            phase 2 starts (auto-advance) → phase 2 agent runs → phase 2 PR
                  │
                  ▼
            phase 2 PR merged → phase 2 completed
                  │
                  ▼
            ... (repeat for all phases)
                  │
                  ▼
            all phases completed → final PR: task branch → main
                  │
                  ▼
            pr_review → merge final PR → done
```

### Agent Platform Integration

When an agent runs against a phase:

1. **Branch creation** — `IWorktreeManager` creates a worktree from the task branch (not `main`). If the task branch doesn't exist yet (first phase), `create_task_branch` hook creates it first.
2. **Artifact scoping** — all artifacts produced by the agent (branch, commits, PR, documents) are created with `phaseId` set to the active phase.
3. **Context assembly** — `AgentContextBuilder` includes:
   - Task metadata and plan (always)
   - All document/mock artifacts from **completed earlier phases** (full content)
   - Git artifacts from earlier phases (branch names, PR links — for reference)
   - The current phase's name and description
4. **PR target** — when the agent creates a PR, it targets the **task branch**, not `main`.

### Data Model

```typescript
interface TaskPhase {
  id: string;              // UUID
  taskId: string;          // FK -> tasks.id
  name: string;            // e.g. 'Backend API', 'Frontend UI'
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  sortOrder: number;       // execution/display order
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601

  /** Populated when fetching — artifacts scoped to this phase. */
  artifacts?: TaskArtifact[];
}

interface CreatePhaseInput {
  taskId: string;
  name: string;
  description?: string;
  sortOrder?: number;
}

interface UpdatePhaseInput {
  name?: string;
  description?: string;
  status?: TaskPhase['status'];
  sortOrder?: number;
}
```

### Phase-Artifact Relationship

Every artifact has an optional `phaseId`. When a task has phases:
- Agents are started against a specific phase
- Artifacts produced by that agent run are created with `phaseId` set
- Each phase has its own branch and PR (targeting the task branch)
- Task-level artifacts (like the final PR) have `phaseId: null`

```
Task: "Add user authentication"
├── artifact: branch (task branch, phaseId: null)
│
├── Phase 1: Backend API (completed)
│   ├── artifact: branch (phase branch, phaseId: phase-1)
│   ├── artifact: pull_request PR #41 → task branch (merged, phaseId: phase-1)
│   ├── artifact: document "API design" (phaseId: phase-1)
│   └── artifact: commits x12 (phaseId: phase-1)
│
├── Phase 2: Frontend UI (in_progress)
│   ├── artifact: branch (phase branch, phaseId: phase-2)
│   ├── artifact: document "Component spec" (phaseId: phase-2)
│   └── artifact: commits x5 (phaseId: phase-2)
│
├── Phase 3: E2E Tests (pending)
│   └── (no artifacts yet)
│
└── artifact: pull_request PR #44 → main (final PR, phaseId: null)
```

When Phase 2's agent starts, it receives Phase 1's API design doc and merged PR info as context. When Phase 3's agent starts, it receives artifacts from both Phase 1 and Phase 2.

### Interface

```typescript
// In ITaskStore
interface ITaskStore {
  // ... existing methods ...

  // ─── Phases ──────────────────────────────────────────────────────
  listPhases(taskId: string): Promise<TaskPhase[]>;
  getPhase(phaseId: string): Promise<TaskPhase | null>;
  createPhase(input: CreatePhaseInput): Promise<TaskPhase>;
  updatePhase(phaseId: string, data: UpdatePhaseInput): Promise<TaskPhase>;
  deletePhase(phaseId: string): Promise<void>;
  reorderPhases(taskId: string, phaseIds: string[]): Promise<void>;
}
```

---

## Task Artifacts

First-class data that accumulates over a task's lifecycle. Artifacts are the tangible outputs of agents and users — git branches, pull requests, design documents, mocks, analysis results, and external links.

Artifacts serve two purposes:
1. **Record keeping** — track what was produced, when, and by whom
2. **Context chain** — artifacts from earlier agents are automatically injected into later agents, enabling multi-step workflows (plan agent → design doc → implement agent → PR)

### Artifact Types

There are four categories of artifacts:

#### Git Artifacts

Produced by the agent execution platform during implementation.

| Type | Description | Created By |
|------|-------------|------------|
| `branch` | Git branch created for this task | system |
| `commit` | Individual commit made by an agent | system |
| `pull_request` | PR created from the task's branch | system |
| `diff` | Summary of changes (files/additions/deletions) | system |

#### Document Artifacts

Produced by agents (plan, design, analysis modes) or created manually by users. The actual content is markdown stored in the `content` field.

| `docType` | Description | Typical Producer |
|-----------|-------------|-----------------|
| `technical_design` | Technical design doc — architecture, data model, API contracts, component breakdown | plan agent |
| `product_spec` | Product/feature spec — user stories, acceptance criteria, edge cases | user or agent |
| `api_design` | API design — endpoints, request/response schemas, auth, versioning | plan agent |
| `test_plan` | Test plan — test cases, coverage strategy, edge cases to validate | plan agent |
| `analysis` | Research/analysis — investigation results, options comparison, root cause analysis | agent |
| `adr` | Architecture decision record — context, decision, consequences | agent or user |

`docType` is an open string, not a closed enum — agents and users can use any value. The above are conventions.

#### Mock Artifacts

Visual design artifacts — generated HTML, screenshots, or links to external design tools.

| `format` | Description | Example |
|----------|-------------|---------|
| `html` | Generated HTML file stored on disk | Agent-generated UI mock |
| `image` | Screenshot or exported image stored on disk | Before/after comparison |
| `figma` | Link to Figma/design tool | External design reference |

#### Link Artifacts

External references attached by users or agents — catch-all for anything that doesn't fit above.

### Data Model

```typescript
/**
 * An artifact attached to a task.
 * Created by agents, users, or the system.
 */
interface TaskArtifact {
  id: string;            // UUID v4
  taskId: string;        // FK -> tasks.id

  /**
   * FK -> task_phases.id. Scopes this artifact to a specific phase.
   * Null for single-phase tasks or task-level artifacts not tied to a phase.
   */
  phaseId?: string;

  /**
   * Artifact type. Determines the shape of metadata and content.
   */
  type: 'branch' | 'pull_request' | 'commit' | 'diff' | 'document' | 'mock' | 'link';

  /** Human-readable label. e.g., 'Technical Design', 'PR #45', 'agent/task-123' */
  label: string;

  /** URL to the resource. GitHub URL, Figma link, external reference, etc. */
  url?: string;

  /**
   * Markdown content for document artifacts. Null for non-document types.
   * This is the actual content produced by the agent — not a link, not a summary.
   * Stored in the database as TEXT.
   */
  content?: string;

  /**
   * Path to a file on disk (relative to project root).
   * Used by mock artifacts (HTML files, images) and optionally by documents
   * that are also saved as files.
   */
  filePath?: string;

  /**
   * Type-specific structured data. Shape varies by artifact type:
   *
   * branch:        { branchName, baseBranch }
   * pull_request:  { prNumber, state, headBranch, baseBranch, mergedAt? }
   * commit:        { hash, message, author, branch }
   * diff:          { filesChanged, additions, deletions }
   * document:      { docType }
   * mock:          { format, width?, height? }
   * link:          { description? }
   */
  metadata: Record<string, any>;

  createdAt: string;     // ISO 8601
  createdBy: 'user' | 'agent' | 'system';

  /**
   * ID of the agent run that created this artifact. Null for user-created artifacts.
   * Links the artifact back to the specific execution that produced it.
   */
  agentRunId?: string;
}

/** Input for creating a new artifact. id and createdAt are auto-generated. */
interface CreateArtifactInput {
  type: TaskArtifact['type'];
  label: string;
  phaseId?: string;
  url?: string;
  content?: string;
  filePath?: string;
  metadata?: Record<string, any>;
  createdBy?: 'user' | 'agent' | 'system';
  agentRunId?: string;
}
```

### Metadata Schemas Per Type

```typescript
// --- Git artifacts ---

interface BranchMetadata {
  branchName: string;      // 'agents-manager/add-auth-abc12345'
  baseBranch: string;      // 'main'
}

interface PullRequestMetadata {
  prNumber: number;
  state: 'open' | 'merged' | 'closed';
  headBranch: string;
  baseBranch: string;
  mergedAt?: string;       // ISO 8601, set when merged
}

interface CommitMetadata {
  hash: string;            // short hash
  message: string;
  author: string;
  branch: string;
}

interface DiffMetadata {
  filesChanged: number;
  additions: number;
  deletions: number;
}

// --- Document artifacts ---

interface DocumentMetadata {
  docType: string;         // 'technical_design' | 'product_spec' | 'api_design' | 'test_plan' | 'analysis' | 'adr' | ...
}

// --- Mock artifacts ---

interface MockMetadata {
  format: 'html' | 'image' | 'figma';
  width?: number;          // viewport/image width in pixels
  height?: number;         // viewport/image height in pixels
}

// --- Link artifacts ---

interface LinkMetadata {
  description?: string;
}
```

### When Artifacts Are Created

| Event | Artifact Type | Created By | Example |
|-------|--------------|------------|---------|
| Agent creates a branch | `branch` | system | `{ branchName: 'agents-manager/add-auth-abc12345', baseBranch: 'main' }` |
| Agent makes commits | `commit` | system | `{ hash: 'abc123', message: 'Add auth middleware' }` |
| Agent creates a PR | `pull_request` | system | `{ prNumber: 45, state: 'open' }` |
| Agent completes implementation | `diff` | system | `{ filesChanged: 5, additions: 142, deletions: 23 }` |
| Plan agent produces a design | `document` | agent | `{ docType: 'technical_design' }` + content |
| Plan agent produces a test plan | `document` | agent | `{ docType: 'test_plan' }` + content |
| Agent generates UI mock | `mock` | agent | `{ format: 'html' }` + filePath |
| Agent takes before/after screenshots | `mock` | agent | `{ format: 'image' }` + filePath |
| User links Figma design | `mock` | user | `{ format: 'figma' }` + url |
| User links external resource | `link` | user | `{ description: 'Slack thread with requirements' }` + url |
| User writes a product spec | `document` | user | `{ docType: 'product_spec' }` + content |
| PR is merged | `pull_request` (updated) | system | `{ ...existing, state: 'merged', mergedAt: '...' }` |

### Artifact Chain — Context Injection

When an agent starts, the `AgentContextBuilder` automatically includes relevant artifacts from the task as context. This is how earlier agent outputs feed into later agents.

```
┌──────────────┐     produces     ┌───────────────────────┐
│  Plan Agent  │ ───────────────→ │ document: tech_design │
└──────────────┘                  │ document: test_plan   │
                                  └───────────┬───────────┘
                                              │ injected as context
                                              ▼
                                  ┌──────────────────────┐     produces     ┌──────────────┐
                                  │  Implement Agent     │ ───────────────→ │ branch       │
                                  └──────────────────────┘                  │ commits      │
                                                                            │ pull_request │
                                                                            │ diff         │
                                                                            └──────┬───────┘
                                                                                   │ injected
                                                                                   ▼
                                                                        ┌──────────────────┐
                                                                        │  Review Agent    │
                                                                        └──────────────────┘
```

The `AgentContextBuilder` assembles context in this order:

```typescript
async function buildAgentContext(task: Task, mode: 'plan' | 'implement' | 'review'): Promise<string> {
  const sections: string[] = [];

  // 1. Task metadata (title, description, priority, tags)
  sections.push(formatTaskMetadata(task));

  // 2. Task plan (if exists)
  if (task.plan) {
    sections.push(`## Plan\n${task.plan}`);
  }

  // 3. Document artifacts — injected as full content
  const docs = await taskStore.listArtifacts(task.id, 'document');
  for (const doc of docs) {
    sections.push(`## ${doc.label}\n${doc.content}`);
  }

  // 4. Mock artifacts — referenced by path/URL
  const mocks = await taskStore.listArtifacts(task.id, 'mock');
  for (const mock of mocks) {
    const ref = mock.filePath || mock.url;
    sections.push(`## Mock: ${mock.label}\nSee: ${ref}`);
  }

  // 5. Git artifacts — branch name, PR link (for review/implement modes)
  if (mode === 'implement' || mode === 'review') {
    const branches = await taskStore.listArtifacts(task.id, 'branch');
    const prs = await taskStore.listArtifacts(task.id, 'pull_request');
    if (branches.length) sections.push(`Branch: ${branches[0].label}`);
    if (prs.length) sections.push(`PR: ${prs[0].url}`);
  }

  // 6. Link artifacts — listed as references
  const links = await taskStore.listArtifacts(task.id, 'link');
  if (links.length) {
    sections.push('## References\n' + links.map(l =>
      `- [${l.label}](${l.url})`
    ).join('\n'));
  }

  // 7. Project instructions (.agents-manager/instructions.md)
  const instructions = await loadProjectInstructions(task.projectId);
  if (instructions) sections.push(`## Project Instructions\n${instructions}`);

  // 8. Recent event log entries (human comments, status changes)
  const events = await eventLog.list(task.id, { limit: 20 });
  sections.push(formatRecentEvents(events));

  return sections.join('\n\n---\n\n');
}
```

**Key design decisions:**
- **Document content is injected in full** — the agent receives the actual markdown, not a summary or link. This is what makes the plan→implement chain work.
- **Mocks are referenced by path/URL** — agents that support vision can read image files; others get the path.
- **Git artifacts provide context** — the implement agent knows which branch to work on, the review agent knows which PR to review.
- **Links are listed as references** — the agent can decide whether to follow them.
- **Order matters** — task metadata and plan come first (most important), then documents, then references.

### Merge Button Flow

The **Merge & Complete** button on the task detail page reads the `pull_request` artifact to perform the merge:

1. Pipeline guard `has_pr` checks that a `pull_request` artifact exists with `state: 'open'`
2. `merge_pr` hook reads the artifact's `prNumber`, calls `IScmPlatform.mergePR()`
3. Artifact metadata is updated: `state` changes from `'open'` to `'merged'`
4. `prUrl` remains on the task for reference
5. Task transitions to `done`
6. Event log records: "PR #45 merged, task completed"

### Interface

Artifacts are managed through `ITaskStore`:

```typescript
// Add a document artifact from a plan agent
await taskStore.addArtifact(taskId, {
  type: 'document',
  label: 'Technical Design: Authentication',
  content: '## Overview\nThis document describes...',
  metadata: { docType: 'technical_design' },
  createdBy: 'agent',
  agentRunId: run.id,
});

// Add a mock artifact
await taskStore.addArtifact(taskId, {
  type: 'mock',
  label: 'Login page mock',
  filePath: '.agents-manager/mocks/login-page.html',
  metadata: { format: 'html', width: 1280, height: 720 },
  createdBy: 'agent',
  agentRunId: run.id,
});

// Add a branch artifact
await taskStore.addArtifact(taskId, {
  type: 'branch',
  label: 'agents-manager/add-auth-abc12345',
  metadata: { branchName: 'agents-manager/add-auth-abc12345', baseBranch: 'main' },
  createdBy: 'system',
});

// User attaches a Figma link
await taskStore.addArtifact(taskId, {
  type: 'mock',
  label: 'Login flow design',
  url: 'https://figma.com/file/abc123',
  metadata: { format: 'figma' },
  createdBy: 'user',
});

// List all artifacts (or filter by type)
const allArtifacts = await taskStore.listArtifacts(taskId);
const docs = await taskStore.listArtifacts(taskId, 'document');
const prs = await taskStore.listArtifacts(taskId, 'pull_request');

// Update artifact (e.g., after merge)
await taskStore.updateArtifact(prArtifact.id, {
  metadata: { ...prArtifact.metadata, state: 'merged', mergedAt: new Date().toISOString() },
});

// Remove an artifact
await taskStore.removeArtifact(artifactId);
```

---

## Task Plan

The `plan` field is a markdown string on the task, populated by the plan-mode agent and used as input for the implement agent.

### Lifecycle

1. **User creates task** -- `plan` is null
2. **User clicks "Plan"** -- triggers pipeline transition (e.g., `open -> planning`), which fires the `start_agent` hook with `mode: 'plan'`
3. **Plan agent runs** -- analyzes the task, reads the codebase, and produces a structured implementation plan in markdown
4. **Plan saved** -- `AgentService` extracts the plan from the agent's transcript and saves it to `task.plan` via `taskStore.updateTask()`
5. **User reviews/edits** -- the plan is displayed on the task detail page with an "Edit" button. User can modify it before proceeding.
6. **User clicks "Implement"** -- triggers the next pipeline transition. The `AgentContextBuilder` injects `task.plan` into the agent's prompt context.
7. **Implement agent uses plan** -- follows the plan to write code, create branches, make commits

### What the Plan Contains

A typical plan includes:
- Files to create or modify
- Key changes in each file
- Order of implementation steps
- Potential risks or edge cases
- Estimated complexity per step

### How the Plan Reaches the Agent

The `AgentContextBuilder` includes the plan as a dedicated section in the agent prompt:

```typescript
// In AgentContextBuilder.build()
if (task.plan) {
  sections.push({ heading: 'Implementation Plan', content: task.plan });
}
```

This ensures the implement agent has full access to the plan. If the user edited the plan, the agent sees the edited version.

---

## Status (Pipeline Integration)

Task status is fundamentally different from other task fields because it is governed entirely by the pipeline system.

### Key Rules

1. **Status is a string, NOT an enum.** Valid values are defined by the pipeline definition assigned to the task via `pipelineId`. Different pipelines have different statuses.

2. **Tasks never change status directly.** All status changes go through the pipeline engine via `WorkflowService.transitionTask()`. Direct updates to `task.status` bypass guards, hooks, event logging, and notifications.

3. **Valid transitions come from the pipeline, never hardcoded.** The UI calls `getValidTransitions(taskId)` to determine which buttons to show. If a guard blocks a transition, the button is disabled with a tooltip explaining why.

4. **The initial status is set by the pipeline.** When a task is created, it gets the pipeline's `initialStatus` (usually `'open'`).

5. **Terminal statuses are defined by the pipeline.** Statuses like `'done'` and `'cancelled'` are terminal -- the pipeline declares them in `terminalStatuses`. The supervisor uses this to trigger cleanup (worktree deletion, etc.).

### How the UI Reads Status

```typescript
// WRONG -- hardcoded status checks
if (task.status === 'done' || task.status === 'cancelled') { /* terminal */ }

// RIGHT -- ask the pipeline engine
const isTerminal = useIsTerminal(task.pipelineId, task.status);
```

```typescript
// WRONG -- show all statuses as buttons
const allStatuses = ['open', 'in_progress', 'done'];

// RIGHT -- show only valid transitions
const validTransitions = useValidTransitions(taskId);
// Each entry includes: transition definition, allowed (bool), blockedBy (reasons)
```

### Status Categories

Each status in a pipeline has a `category` that groups it for UI and supervisor purposes:

| Category | Meaning | Example Statuses |
|----------|---------|-----------------|
| `backlog` | Not started | open, planned |
| `active` | Work in progress | planning, in_progress, changes_requested |
| `review` | Waiting for review | pr_review |
| `waiting` | Blocked on human input | needs_info, options_proposed |
| `done` | Terminal | done, cancelled |
| `blocked` | Stuck / failed | failed |

---

## Database Schema

### `tasks` table

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
  tags TEXT DEFAULT '[]',               -- JSON array of strings
  plan TEXT,                            -- nullable, markdown
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
```

### `task_dependencies` table

```sql
CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id)
);
```

- `task_id` is the blocked task.
- `depends_on_task_id` is the blocking task.
- The composite primary key prevents duplicate dependencies.
- `ON DELETE CASCADE` ensures cleanup when either task is deleted.

### `task_notes` table

```sql
CREATE TABLE IF NOT EXISTS task_notes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  author TEXT NOT NULL,                 -- 'user' or agent type name
  created_at TEXT NOT NULL
);

CREATE INDEX idx_task_notes_task ON task_notes(task_id);
```

### `task_phases` table

```sql
CREATE TABLE IF NOT EXISTS task_phases (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                   -- e.g. 'Backend API', 'Frontend UI', 'Tests'
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'in_progress' | 'completed' | 'skipped'
  sort_order INTEGER DEFAULT 0,         -- display/execution order
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_task_phases_task ON task_phases(task_id);
```

### `task_artifacts` table

```sql
CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  phase_id TEXT REFERENCES task_phases(id) ON DELETE SET NULL, -- nullable, scopes artifact to a phase
  type TEXT NOT NULL,                   -- 'branch', 'pull_request', 'commit', 'diff', 'document', 'mock', 'link'
  label TEXT NOT NULL,
  url TEXT,                             -- nullable, external URL
  content TEXT,                         -- nullable, markdown content for document artifacts
  file_path TEXT,                       -- nullable, path relative to project root (mocks, exported docs)
  metadata TEXT DEFAULT '{}',           -- JSON, type-specific data
  created_by TEXT NOT NULL DEFAULT 'system', -- 'user', 'agent', or 'system'
  agent_run_id TEXT,                    -- nullable, FK -> agent_runs.id
  created_at TEXT NOT NULL
);

CREATE INDEX idx_task_artifacts_task ON task_artifacts(task_id);
CREATE INDEX idx_task_artifacts_type ON task_artifacts(type);
CREATE INDEX idx_task_artifacts_phase ON task_artifacts(phase_id);
```

---

## IPC Channels

All task-related IPC channels. These are thin wrappers that call `WorkflowService` methods -- zero logic in the IPC layer.

| Channel | Direction | Payload | Response | Description |
|---------|-----------|---------|----------|-------------|
| `tasks:list` | renderer -> main | `{ projectId, filters? }` | `Task[]` | List tasks with optional filters |
| `tasks:get` | renderer -> main | `{ id }` | `Task` | Get single task with dependencies and subtasks |
| `tasks:create` | renderer -> main | `CreateTaskInput` | `Task` | Create a new task |
| `tasks:update` | renderer -> main | `{ id, ...UpdateTaskInput }` | `Task` | Update task fields |
| `tasks:delete` | renderer -> main | `{ id }` | `void` | Delete a task |
| `tasks:reorder` | renderer -> main | `{ id, status, sortOrder }` | `void` | Reorder within a kanban column |
| `tasks:add-dependency` | renderer -> main | `{ taskId, dependsOnTaskId }` | `void` | Add a dependency |
| `tasks:remove-dependency` | renderer -> main | `{ taskId, dependsOnTaskId }` | `void` | Remove a dependency |

### IPC Handler Registration

```typescript
// src/main/ipc-handlers.ts

export function registerIpcHandlers(workflowService: IWorkflowService) {
  ipcMain.handle('tasks:list', (_, projectId, filters) =>
    workflowService.listTasks(projectId, filters));

  ipcMain.handle('tasks:get', (_, taskId) =>
    workflowService.getTask(taskId));

  ipcMain.handle('tasks:create', (_, input) =>
    workflowService.createTask(input));

  ipcMain.handle('tasks:update', (_, taskId, input) =>
    workflowService.updateTask(taskId, input));

  ipcMain.handle('tasks:delete', (_, taskId) =>
    workflowService.deleteTask(taskId));

  // Reorder, dependencies, notes, etc. follow the same pattern
}
```

---

## Cross-References

| Topic | Document | What It Covers |
|-------|----------|---------------|
| Pipeline system | [pipeline/index.md](pipeline/index.md) | How task statuses and transitions are defined by pipelines |
| Pipeline engine | [pipeline/engine.md](pipeline/engine.md) | Core engine that validates and executes transitions |
| Pipeline JSON | [pipeline/json-contract.md](pipeline/json-contract.md) | Pipeline definition format, guards, hooks, built-in pipelines |
| Task event log | [pipeline/event-log.md](pipeline/event-log.md) | Chronological stream of everything that happens on a task |
| Agent platform | [agent-platform.md](agent-platform.md) | Full 10-step lifecycle of running an agent on a task |
| Workflow service | [workflow-service.md](workflow-service.md) | Single entry point for all task operations across all UIs |
| Architecture | [overview.md](overview.md) | ITaskStore interface, dependency injection, abstraction layers |
