# Pipeline Engine

See also: [json-contract.md](json-contract.md) | [outcome-schemas.md](outcome-schemas.md) | [event-log.md](event-log.md) | [errors.md](errors.md) | [ui.md](ui.md)

The core runtime that validates transitions, executes hooks, and enforces the pipeline state machine.

## Problem

Task statuses are not a flat list - they're a **workflow graph** that:
- Differs by task type (bug vs feature vs custom)
- Grows over time (start with 3 statuses, evolve to 10+)
- Supports agent-driven transitions (agent completes → task moves forward)
- Supports loops (PR reviewer requests changes → task goes back to implementation)
- Must be extensible without changing existing application code

## Core Idea

**Pipelines are data, not code.** A pipeline is a JSON definition of statuses and transitions. The application has a **pipeline engine** that reads these definitions and enforces them. Adding a new status or transition means editing the pipeline definition - zero code changes in UI, services, or IPC.

## Pipeline Engine

The engine is the central runtime. Everything goes through it - UI, agents, CLI, services.

```typescript
// src/main/interfaces/pipeline-engine.ts

interface IPipelineEngine {
  // === Query ===

  // Get the pipeline definition for a task (based on task type or project config)
  getPipeline(taskId: string): Promise<PipelineDefinition>;

  // Get all available pipelines
  listPipelines(): Promise<PipelineDefinition[]>;

  // Get valid next statuses for a task (respects guards)
  getValidTransitions(taskId: string, trigger?: TransitionTrigger): Promise<ValidTransition[]>;

  // Check if a specific transition is allowed right now
  canTransition(taskId: string, toStatus: string): Promise<TransitionCheck>;

  // Is this status a terminal status?
  isTerminal(pipelineId: string, statusId: string): boolean;

  // Get all statuses for a pipeline (for kanban columns, dropdowns, etc.)
  getStatuses(pipelineId: string): PipelineStatus[];

  // === Mutate ===

  // Execute a transition (validates, updates task, fires hooks)
  transition(taskId: string, toStatus: string, context: TransitionContext): Promise<TransitionResult>;

  // === Pipeline CRUD ===

  // Create/update/delete pipeline definitions
  savePipeline(definition: PipelineDefinition): Promise<PipelineDefinition>;
  deletePipeline(pipelineId: string): Promise<void>;

  // === History ===

  // Get transition history for a task
  getHistory(taskId: string): Promise<TransitionHistoryEntry[]>;
}

interface ValidTransition {
  transition: PipelineTransition;
  allowed: boolean;
  blockedBy?: string[];    // guard descriptions that failed
}

interface TransitionCheck {
  allowed: boolean;
  blockedBy?: string[];    // guard descriptions that failed
  transition?: PipelineTransition;
}

interface TransitionContext {
  triggeredBy: 'user' | 'agent' | 'system';
  agentRunId?: string;     // if triggered by agent
  reason?: string;         // optional note ("PR review requested changes")
}

interface TransitionResult {
  success: boolean;
  task: Task;
  previousStatus: string;
  newStatus: string;
  hooksExecuted: string[];
  error?: string;
}

interface TransitionHistoryEntry {
  id: string;
  taskId: string;
  fromStatus: string;
  toStatus: string;
  triggeredBy: 'user' | 'agent' | 'system';
  agentRunId?: string;
  reason?: string;
  timestamp: string;
}
```

### Key Rule

**Nothing changes task status directly.** Everything goes through `pipelineEngine.transition()`. This ensures:
- Transitions are always validated
- Guards are always checked
- Hooks always fire
- History is always recorded

```typescript
// WRONG - never do this
await taskStore.updateTask(taskId, { status: 'in_progress' });

// RIGHT - always do this
await pipelineEngine.transition(taskId, 'in_progress', { triggeredBy: 'user' });
```

### Atomic Transitions (SQLite Single-Writer Serialization)

The `transition()` method wraps the guard check, status update, and run record creation in a **single SQLite transaction**. SQLite's single-writer lock guarantees that only one concurrent call can succeed -- the second attempt will see the already-updated status and fail the guard (e.g., `no_running_agent`).

```typescript
// Inside PipelineEngineImpl.transition():
// Atomic: guard check + status update + run creation in one transaction
const result = db.transaction(() => {
  const guardResults = this.runGuards(task, transition);
  if (!guardResults.every(g => g.passed)) throw new GuardFailedError(guardResults);
  taskStore.updateStatus(task.id, transition.to);
  const run = agentRunStore.create({ taskId: task.id, ... });
  return { guardResults, run };
})();
```

This prevents race conditions where two concurrent `startAgent` calls could both pass the guard check before either updates the status. With the transaction, the entire check-and-update is serialized by SQLite's write lock.

## Agent ↔ Pipeline Integration

This is the key interaction. Agents don't just run - they participate in the pipeline.

### Agent Triggers Pipeline Transitions

When an agent finishes, the `AgentService` tells the pipeline engine. There are two distinct cases:

1. **Agent completed successfully** with a named outcome (e.g., "pr_ready", "plan_complete", "needs_info", "changes_requested"). The outcome is a structured result — the agent did its job.
2. **Agent process failed** — crashed, timed out, or threw an unhandled exception. This is an actual error.

```typescript
// In AgentService, after agent completes:
async onAgentCompleted(runId: string, result: AgentRunResult) {
  const run = await this.agentRunStore.getById(runId);

  if (result.exitCode === 0 && result.outcome) {
    // Agent completed successfully with a named outcome
    const transitions = await this.pipelineEngine.getValidTransitions(
      run.taskId,
      { type: 'agent_outcome', outcome: result.outcome }
    );

    if (transitions.length === 1) {
      // Single valid transition for this outcome - auto-execute
      await this.pipelineEngine.transition(run.taskId, transitions[0].transition.to, {
        triggeredBy: 'agent',
        agentRunId: runId,
        payload: result.payload,  // structured data (e.g., NeedsInfoPayload)
      });
    }
    // If multiple valid transitions, don't auto-execute (needs user decision)
  } else {
    // Agent process failed (crash, timeout, exception)
    const transitions = await this.pipelineEngine.getValidTransitions(
      run.taskId,
      { type: 'agent_error' }
    );

    if (transitions.length === 1) {
      await this.pipelineEngine.transition(run.taskId, transitions[0].transition.to, {
        triggeredBy: 'agent',
        agentRunId: runId,
        reason: result.error,
      });
    }
  }
}
```

### Pipeline Triggers Agent Runs

Hooks on transitions can auto-start agents:

```json
{
  "id": "pr_review_to_changes_requested",
  "from": "pr_review",
  "to": "pr_review",
  "label": "Start PR Review",
  "trigger": { "type": "manual" },
  "hooks": [
    {
      "type": "start_agent",
      "params": {
        "agentType": "claude-code",
        "mode": "review"
      }
    }
  ]
}
```

### Hook Execution Error Handling

When a transition fires, the status change is committed **before** hooks run. Hook failures must never roll back a committed transition. Each hook is executed inside its own try/catch — if a hook throws, the error is logged to the event log and the remaining hooks continue executing.

**Rationale (Decision 3a):** Non-critical hooks (notifications, starting agents) should never block a transition. The task's status is the source of truth; hooks are side-effects.

```typescript
// Inside pipelineEngine.transition(), after status is persisted:

const hookResults: HookResult[] = [];

for (const hook of transition.hooks) {
  try {
    await executeHook(hook, task, transitionContext);
    hookResults.push({ hook: hook.type, status: 'ok' });
  } catch (err) {
    // Log error but continue — never block the transition
    hookResults.push({ hook: hook.type, status: 'error', error: String(err) });
    await eventLog.log({
      taskId,
      category: 'hook',
      type: 'hook.failed',
      summary: `Hook "${hook.type}" failed: ${err.message}`,
      data: { hook, error: String(err) },
      actor: { type: 'system' },
      level: 'error',
    });
  }
}

// hookResults are stored in transition_history.hooks_executed
```

The `TransitionResult.hooksExecuted` array records which hooks succeeded and which failed, so callers and the UI can surface hook failures without the transition itself being considered failed.

### Full Loop Example: PR Review

```
1. Task is "In Progress"
2. Implementation agent completes with outcome "pr_ready"
3. Pipeline auto-transitions to "PR Review" (agent_outcome trigger)
4. "PR Review" entry hook auto-starts PR review agent
5. PR review agent finishes:
   a. Outcome "approved" → auto-transition to "Done"
   b. Outcome "changes_requested" → auto-transition to "Changes Requested"
6. "Changes Requested" entry hook auto-starts implementation agent
7. Back to step 3
```

Pipeline definition for this:
```json
{
  "transitions": [
    {
      "from": "in_progress",
      "to": "pr_review",
      "trigger": { "type": "agent_outcome", "outcome": "pr_ready" },
      "hooks": [
        { "type": "start_agent", "params": { "agentType": "claude-code", "mode": "review" } }
      ]
    },
    {
      "from": "pr_review",
      "to": "done",
      "trigger": { "type": "agent_outcome", "outcome": "approved" }
    },
    {
      "from": "pr_review",
      "to": "changes_requested",
      "trigger": { "type": "agent_outcome", "outcome": "changes_requested" },
      "hooks": [
        { "type": "start_agent", "params": { "agentType": "claude-code", "mode": "implement" } },
        { "type": "notify", "params": { "title": "PR Review: Changes Requested" } }
      ]
    },
    {
      "from": "changes_requested",
      "to": "pr_review",
      "trigger": { "type": "agent_outcome", "outcome": "pr_ready" },
      "hooks": [
        { "type": "start_agent", "params": { "agentType": "claude-code", "mode": "review" } }
      ]
    }
  ]
}
```

## Abstraction Interface

Following the architecture pattern, the pipeline engine is also behind an interface:

```typescript
// src/main/interfaces/pipeline-engine.ts
// (the IPipelineEngine interface defined above)
```

And pipeline definitions are stored through `IStorage` or a dedicated `IPipelineStore`:

```typescript
interface IPipelineStore {
  list(): Promise<PipelineDefinition[]>;
  getById(id: string): Promise<PipelineDefinition | null>;
  getDefault(): Promise<PipelineDefinition>;
  save(definition: PipelineDefinition): Promise<PipelineDefinition>;
  delete(id: string): Promise<void>;
}
```

Phase 1 implementation: `SqlitePipelineStore` - stores pipeline JSON in SQLite.

## Database Schema

### `pipelines` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | Primary key |
| name | TEXT | Display name |
| description | TEXT | Optional description |
| definition | TEXT | JSON blob (full PipelineDefinition) |
| is_default | INTEGER | 1 if this is the default pipeline |
| created_at | TEXT (ISO) | Timestamp |
| updated_at | TEXT (ISO) | Timestamp |

### `transition_history` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| task_id | TEXT | FK → tasks.id |
| pipeline_id | TEXT | Which pipeline was active |
| from_status | TEXT | Previous status |
| to_status | TEXT | New status |
| transition_id | TEXT | Which transition definition was used |
| triggered_by | TEXT | 'user', 'agent', 'system' |
| agent_run_id | TEXT | FK → agent_runs.id (nullable) |
| reason | TEXT | Optional explanation |
| guards_checked | TEXT | JSON array of guard results |
| hooks_executed | TEXT | JSON array of hook results |
| created_at | TEXT (ISO) | Timestamp |

### `task_events` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| task_id | TEXT | FK → tasks.id |
| category | TEXT | lifecycle, transition, agent, payload, guard, hook, edit, note, git, error |
| type | TEXT | Specific event type (e.g., 'status.changed', 'agent.started') |
| summary | TEXT | Human-readable one-line summary |
| data | TEXT | JSON blob with structured event data |
| actor_type | TEXT | 'user', 'agent', 'system', 'hook', 'guard' |
| actor_name | TEXT | Agent type, hook name, etc. (nullable) |
| agent_run_id | TEXT | FK → agent_runs.id (nullable) |
| level | TEXT | 'info', 'warning', 'error', 'debug' |
| created_at | TEXT (ISO) | Timestamp |

### Changes to `tasks` table

```sql
-- Add pipeline_id and pending_payload to tasks
ALTER TABLE tasks ADD COLUMN pipeline_id TEXT DEFAULT 'default';
ALTER TABLE tasks ADD COLUMN pending_payload TEXT;  -- JSON TransitionPayload, null when not waiting
ALTER TABLE tasks ADD COLUMN agent_context TEXT;    -- extra context for next agent run, null when not needed
```

### Changes to `transition_history` table

```sql
-- Add payload column
ALTER TABLE transition_history ADD COLUMN payload TEXT;  -- JSON TransitionPayload
```

The `status` field on `tasks` remains as-is. It stores the current status ID, which maps to a status in the task's pipeline definition.

## Phase Rollout

### Phase 1
- Pipeline engine with `IPipelineEngine` interface
- `SqlitePipelineStore` for pipeline definitions
- "Simple" pipeline as default (open, in_progress, done, cancelled)
- Kanban reads columns from pipeline definition
- Status transitions go through engine (with history tracking)
- No guards, no hooks yet (just validation + history)

### Phase 2
- Add `start_agent` and `notify` hooks
- Add `has_plan`, `no_running_agent` guards
- "Standard" pipeline with planning + implementation statuses
- Agent completion triggers pipeline transitions

### Phase 3
- Pipeline used by CLI/HTTP API for status updates
- Guards checked on CLI transitions too

### Phase 4
- Pipeline editor UI in settings
- Pipeline visualization (graph view)
- Pipeline debugger (history timeline)
- Dashboard reads from pipeline for status grouping

### Phase 5
- Per-task-type pipelines (bug pipeline, feature pipeline)
- Pipeline templates (import/export)
- Advanced hooks (create_branch, create_pr, etc.)

## Migration

```sql
-- Part of Phase 1 migrations

CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  definition TEXT NOT NULL,
  is_default INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transition_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  pipeline_id TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  transition_id TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'user',
  agent_run_id TEXT,
  reason TEXT,
  payload TEXT,
  guards_checked TEXT DEFAULT '[]',
  hooks_executed TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_transition_history_task ON transition_history(task_id);
CREATE INDEX idx_transition_history_created ON transition_history(created_at);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  data TEXT DEFAULT '{}',
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_name TEXT,
  agent_run_id TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_task_events_task ON task_events(task_id);
CREATE INDEX idx_task_events_category ON task_events(category);
CREATE INDEX idx_task_events_level ON task_events(level);
CREATE INDEX idx_task_events_created ON task_events(created_at);

-- Seed default pipeline
INSERT INTO pipelines (id, name, description, definition, is_default, created_at, updated_at)
VALUES ('simple', 'Simple', 'Basic task workflow', '{"id":"simple","name":"Simple",...}', 1, datetime('now'), datetime('now'));
```
