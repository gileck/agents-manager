# Task Management

Tasks, dependencies, subtasks, features, and filtering.

## Task Data Model

**File:** `src/shared/types.ts`

```typescript
interface Task {
  id: string;
  projectId: string;
  pipelineId: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  tags: string[];                     // JSON array in DB
  parentTaskId: string | null;
  featureId: string | null;
  assignee: string | null;
  prLink: string | null;
  branchName: string | null;
  plan: string | null;
  subtasks: Subtask[];                // JSON array in DB
  planComments: PlanComment[];        // JSON array in DB
  metadata: Record<string, unknown>;  // JSON object in DB
  createdAt: number;                  // millisecond timestamp
  updatedAt: number;
}

interface Subtask {
  name: string;
  status: SubtaskStatus;  // 'open' | 'in_progress' | 'done'
}

interface PlanComment {
  author: string;
  content: string;
  createdAt: number;
}
```

## Task CRUD

**Store:** `src/main/stores/sqlite-task-store.ts` implements `ITaskStore`

All CRUD operations go through `WorkflowService` (`src/main/services/workflow-service.ts`), which adds activity logging on each operation.

| Operation | WorkflowService Method | Activity Action |
|-----------|----------------------|-----------------|
| Create | `createTask(input)` | `create` |
| Read | (via IPC directly to store) | — |
| Update | `updateTask(id, input)` | `update` |
| Delete | `deleteTask(id)` | `delete` |
| Reset | `resetTask(id)` | `reset` |
| Transition | `transitionTask(taskId, toStatus, actor?)` | `transition` |

## Task Reset

`resetTask(id)` reverts a task to its initial state while preserving its identity and dependencies.

**Preserved:** task record (id, projectId, pipelineId, title, description, priority, tags, parentTaskId, assignee, featureId, metadata, createdAt), task dependencies

**Cleared:**
- Status → pipeline's first status
- `plan` → NULL
- `subtasks` → `[]`
- `planComments` → `[]`
- `prLink` → NULL
- `branchName` → NULL

**Deleted (cascade):** task_context_entries, pending_prompts, task_phases, task_artifacts, agent_runs, task_events, transition_history

**Worktree cleanup:** Before reset, `WorkflowService.cleanupWorktree()` unlocks and deletes the worktree, then tries to delete the remote branch.

## Dependencies

**Table:** `task_dependencies` with composite PK `(task_id, depends_on_task_id)`

```typescript
addDependency(taskId, dependsOnTaskId)   // INSERT OR IGNORE
removeDependency(taskId, dependsOnTaskId) // DELETE
getDependencies(taskId)                    // Tasks this task depends on
getDependents(taskId)                      // Tasks that depend on this task
```

The `dependencies_resolved` guard (see [pipeline-engine.md](./pipeline-engine.md)) blocks transitions if any dependency task has not reached a final status. It uses `json_each()` on the pipeline's statuses JSON to find final statuses.

## Subtasks

Subtasks are stored as a JSON array in the `tasks.subtasks` column.

```typescript
interface Subtask {
  name: string;
  status: 'open' | 'in_progress' | 'done';
}
```

**Populated by:** The plan agent during `plan` or `plan_revision` mode. The agent's structured output includes a `subtasks` array of step names.

**Tracked via CLI:** The `am tasks subtask` command group allows agents to update subtask status during execution:
- `am tasks subtask update <taskId> --name "Step 1" --status done`

This allows agents running in worktrees to report progress by calling the CLI.

## Plan and Plan Comments

### Plan

The `plan` field holds a markdown-formatted implementation plan, populated by the plan agent. It is:
- `null` on creation
- Set when the plan agent completes (from structured output)
- Passed to the implement agent as context
- Reset to `null` on `resetTask()`

### Plan Comments

Admin feedback for plan revision. Stored as a JSON array of `PlanComment` objects.

When a plan needs revision, an admin adds comments. The `plan_revision` agent receives these comments via the `{planCommentsSection}` template variable, allowing it to address specific feedback.

## Features / Epics

**Store:** `src/main/stores/sqlite-feature-store.ts` implements `IFeatureStore`

```typescript
interface Feature {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

interface FeatureWithProgress extends Feature {
  status: FeatureStatus;   // 'open' | 'in_progress' | 'done'
  totalTasks: number;
  doneTasks: number;
}
```

Tasks link to features via the `featureId` field. A feature's progress is computed from the count of its tasks in final vs non-final statuses.

Deleting a feature unlinks all its tasks (`feature_id = NULL`) rather than deleting them.

## Task Filtering

**Type:** `TaskFilter` in `src/shared/types.ts`

```typescript
interface TaskFilter {
  projectId?: string;
  pipelineId?: string;
  status?: string;
  priority?: number;
  assignee?: string;
  parentTaskId?: string | null;  // null = root tasks only
  featureId?: string | null;     // null = unlinked tasks only
  tag?: string;                   // exact match on single tag
  search?: string;                // LIKE match on title + description
}
```

All filters combine with AND. Tag filtering uses SQLite's `json_each()` function:

```sql
WHERE EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)
```

Results are ordered by `created_at DESC`.

## Task Artifacts

**Store:** `src/main/stores/sqlite-task-artifact-store.ts`

```typescript
interface TaskArtifact {
  id: string;
  taskId: string;
  type: ArtifactType;  // 'branch' | 'pr' | 'commit' | 'diff' | 'document'
  data: Record<string, unknown>;
  createdAt: number;
}
```

Artifacts are created by the SCM handler during PR workflows:

| Type | Created By | Data Fields |
|------|-----------|-------------|
| `branch` | Agent service | `{ name, remote }` |
| `pr` | `push_and_create_pr` hook | `{ url, number }` |
| `commit` | Git operations | `{ hash, message }` |
| `diff` | `push_and_create_pr` hook | `{ content }` (raw diff) |
| `document` | Agent output | Various |

Artifacts are deleted on `resetTask()` and `deleteTask()`.

## Edge Cases

- **Status cannot be set via `updateTask`** — the IPC handler strips the `status` field from update payloads. Status changes must go through `transitionTask()` to enforce guards and hooks.
- **Tags and subtasks** are stored as JSON strings in SQLite. They are parsed with `parseJson()` (which never throws) on read.
- Both **delete and reset** clean up worktrees (unlock, delete worktree, attempt remote branch deletion). Cleanup is best-effort — errors are caught and ignored.
- **`parentTaskId`** enables hierarchical tasks but has no special pipeline behavior — it is purely organizational.
- **Feature deletion** unlinks tasks rather than deleting them, preserving work.
