# Event System

Events, activity log, transition history, and debug timeline.

## Three Log Systems

The application maintains three complementary log systems, each serving a different purpose:

| System | Scope | Table | Purpose |
|--------|-------|-------|---------|
| **TaskEventLog** | Per-task, granular | `task_events` | Detailed timeline of everything that happens to a task |
| **ActivityLog** | Cross-entity | `activity_log` | High-level action audit across all entities |
| **TransitionHistory** | Per-task, transitions only | `transition_history` | Status change audit trail with guard results |

## TaskEventLog

**Interface:** `ITaskEventLog` in `src/main/interfaces/task-event-log.ts`
**Store:** `src/main/stores/sqlite-task-event-log.ts`

```typescript
interface TaskEvent {
  id: string;
  taskId: string;
  category: TaskEventCategory;
  severity: TaskEventSeverity;
  message: string;
  data: Record<string, unknown>;
  createdAt: number;
}
```

### Categories

| Category | Source | Description |
|----------|--------|-------------|
| `status_change` | PipelineEngine | Status transitions |
| `field_update` | Task store | Field value changes |
| `dependency_change` | Task store | Dependency added/removed |
| `comment` | Plan comments | Admin feedback added |
| `system` | Various | System-level events (guard failures, errors) |
| `agent` | AgentService, handlers | Agent lifecycle milestones |
| `agent_debug` | Agent execution | Debug output from agent runs |
| `git` | SCM handler | Git operations (diff, commit, rebase) |
| `github` | SCM handler | GitHub operations (PR create, merge) |
| `worktree` | WorktreeManager | Worktree create, lock, delete |

### Severities

`debug`, `info`, `warning`, `error`

### Filtering

```typescript
interface TaskEventFilter {
  taskId?: string;
  category?: TaskEventCategory;
  severity?: TaskEventSeverity;
  since?: number;    // timestamp
  until?: number;    // timestamp
}
```

Results ordered by `created_at ASC`.

## ActivityLog

**Interface:** `IActivityLog` in `src/main/interfaces/activity-log.ts`
**Store:** `src/main/stores/sqlite-activity-log.ts`

```typescript
interface ActivityEntry {
  id: string;
  action: ActivityAction;
  entityType: ActivityEntity;
  entityId: string;
  projectId: string | null;
  summary: string;
  data: Record<string, unknown>;
  createdAt: number;
}
```

### Actions

| Action | Logged By | Description |
|--------|-----------|-------------|
| `create` | WorkflowService | Entity created |
| `update` | WorkflowService | Entity fields updated |
| `delete` | WorkflowService | Entity deleted |
| `reset` | WorkflowService | Task reset to initial state |
| `transition` | WorkflowService | Task status transition |
| `system` | Various | System-level action |
| `agent_start` | WorkflowService | Agent execution started |
| `agent_complete` | WorkflowService | Agent execution stopped/completed |
| `prompt_response` | WorkflowService | Human answered a prompt |

### Entity Types

`project`, `task`, `pipeline`, `system`, `agent_run`

### Filtering

```typescript
interface ActivityFilter {
  action?: ActivityAction;
  entityType?: ActivityEntity;
  entityId?: string;
  projectId?: string;
  since?: number;
  until?: number;
}
```

The `projectId` field enables scoped filtering — the dashboard uses it to show activity for the current project only.

## TransitionHistory

Stored in the `transition_history` table. Written by `PipelineEngine` during `executeTransition()`.

```typescript
interface TransitionHistoryEntry {
  id: string;
  taskId: string;
  fromStatus: string;
  toStatus: string;
  trigger: TransitionTrigger;  // 'manual' | 'agent' | 'system'
  actor: string | null;
  guardResults: Record<string, GuardResult>;
  createdAt: number;
}
```

Each entry records:
- The status change (from → to)
- Who/what triggered it (manual/agent/system + actor name)
- Guard evaluation results (which guards ran, whether they passed)

Indexed by `(task_id, created_at)` for efficient per-task queries.

## Task Context Entries

**Interface:** `ITaskContextStore` in `src/main/interfaces/task-context-store.ts`
**Store:** `src/main/stores/sqlite-task-context-store.ts`

```typescript
interface TaskContextEntry {
  id: string;
  taskId: string;
  agentRunId: string | null;
  source: string;       // 'agent' | 'reviewer'
  entryType: string;    // 'plan_summary', 'implementation_summary', 'review_feedback', etc.
  summary: string;
  data: Record<string, unknown>;
  createdAt: number;
}
```

Context entries are the accumulated knowledge from agent runs. After each successful run, a summary is saved. Subsequent agents receive all prior context entries prepended to their prompt (see [agent-system.md](./agent-system.md)).

Entry types by source:

| Source | Entry Types |
|--------|------------|
| `agent` | `plan_summary`, `plan_revision_summary`, `investigation_summary`, `implementation_summary`, `fix_summary`, `agent_output` |
| `reviewer` | `review_approved`, `review_feedback` |

Ordered by `created_at ASC` — chronological accumulation.

## Debug Timeline

**IPC handler:** `TASK_DEBUG_TIMELINE` in `src/main/ipc-handlers.ts`

The debug timeline aggregates data from 8 sources into a unified, time-sorted view:

```typescript
interface DebugTimelineEntry {
  timestamp: number;
  source: string;      // 'event' | 'activity' | 'transition' | 'agent' | 'phase' | 'artifact' | 'prompt' | 'context'
  severity: string;    // 'info' | 'warning' | 'error' | 'debug'
  title: string;
  data?: Record<string, unknown>;
}
```

### Aggregation Sources

| Source | Data | Title Format |
|--------|------|-------------|
| `event` | Task events (excluding `status_change`) | Event message |
| `activity` | Activity log entries for task | Activity summary |
| `transition` | Transition history | `"{from} → {to} ({trigger})"` |
| `agent` | Agent run records | `"Agent {mode}/{type}: {status}"` |
| `phase` | Task phase records | `"Phase {phase}: {status}"` |
| `artifact` | Task artifacts | `"Artifact: {type}"` |
| `prompt` | Pending prompts | `"Prompt: {promptType} ({status})"` |
| `context` | Task context entries | `"Context: [{source}] {entryType}"` |

### Severity Mapping

- Agent runs: `error` if failed/timed_out, `info` otherwise
- Phases: `error` if failed, `info` otherwise
- Events: mapped from original event severity
- Other sources: `info`

Timeline is sorted by timestamp descending (most recent first).

## Event Categories and When They Fire

### `status_change`

Fired by `PipelineEngine.executeTransition()` after committing the status update. Records `fromStatus`, `toStatus`, and trigger type.

### `field_update`

Fired when task fields change via `updateTask()`. Records which fields changed.

### `dependency_change`

Fired on `addDependency()` and `removeDependency()`. Records the dependency relationship.

### `comment`

Fired when plan comments are added to a task.

### `system`

Fired for system-level events: guard failures, recovery operations, configuration changes.

### `agent`

Fired at agent lifecycle milestones:
- Agent started (with mode, type)
- Prompt created/answered
- Agent completed (with outcome)
- Agent stopped/failed/timed out

### `agent_debug`

High-volume debug output from agent execution. Includes raw output lines, SDK messages.

### `git`

Fired during git operations: diff collection, commit creation, branch push, rebase operations.

### `github`

Fired during GitHub operations: PR creation, PR merge, PR status checks.

### `worktree`

Fired during worktree operations: create, lock, unlock, delete.

## Edge Cases

- **`agent_debug` events are high-volume.** A single agent run can produce hundreds of debug events. The events list in the CLI supports `--category` filtering to exclude these.
- **`status_change` events are excluded from the debug timeline** to avoid duplication with `TransitionHistory` entries, which contain richer data (guard results, trigger, actor).
- **Event writes are fire-and-forget.** `taskEventLog.log()` calls are not awaited in most contexts — a logging failure should never block business operations.
- **ActivityLog has `projectId`** for scoped filtering. This was added later (migration 040) and may be null on older entries.
- **Context entry summaries** are truncated to 500 characters in the debug timeline display but stored at full length (up to 2000 chars) in the database.
- **TransitionHistory records guard results** even for successful transitions, providing an audit trail of which guards were evaluated and passed.
