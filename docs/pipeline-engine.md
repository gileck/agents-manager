---
title: Pipeline Engine
description: State machine, transitions, guards, hooks, and seeded pipelines
summary: "PipelineEngine drives task state transitions. Transitions have triggers (manual/agent/system), guards (blocking checks), and hooks (async side-effects with three execution policies). Five seeded pipelines: AGENT_PIPELINE, BUG_AGENT_PIPELINE, SIMPLE_PIPELINE, FEATURE_PIPELINE, and BUG_PIPELINE."
priority: 2
key_points:
  - "Guards are synchronous and block transitions; hooks are async side-effects after success"
  - "Hook execution policies: required (rollback on failure), best_effort (log only), fire_and_forget (not awaited)"
  - "Use AGENT_PIPELINE.id for agent workflow tests, SIMPLE_PIPELINE.id for basic flows"
  - "File: src/core/services/pipeline-engine.ts"
---
# Pipeline Engine

State machine, transitions, guards, hooks, and seeded pipelines.

## Core Concepts

A **Pipeline** defines a set of statuses and the transitions between them. Each task is bound to exactly one pipeline.

- **Status** — a named state (e.g., `open`, `implementing`, `pr_review`) with a label, color, and optional `isFinal` flag
- **Transition** — a directed edge from one status to another, with a trigger type, optional guards, and optional hooks
- **Trigger** — who can fire the transition: `manual` (user), `agent` (outcome-driven), or `system`
- **Guard** — synchronous check that can block a transition (e.g., "task must have a PR link")
- **Hook** — asynchronous side-effect that runs after a successful transition (e.g., "start an agent"), with a configurable execution policy

## PipelineEngine Implementation

**File:** `src/core/services/pipeline-engine.ts`

```typescript
export class PipelineEngine implements IPipelineEngine {
  private guards = new Map<string, GuardFn>();
  private hooks = new Map<string, HookFn>();

  constructor(
    private pipelineStore: IPipelineStore,
    private taskStore: ITaskStore,
    private taskEventLog: ITaskEventLog,
    private db: Database.Database,
  ) {}
}
```

### `getValidTransitions(task, trigger?)`

Returns transitions from the task's current status (or wildcard `*` source). Optionally filters by trigger type.

### `executeTransition(task, toStatus, context?)`

Executes a state transition. Default context is `{ trigger: 'manual' }`.

**Steps:**

1. Validate the transition exists in the pipeline definition
2. Open a **synchronous** better-sqlite3 transaction
3. Re-fetch the task inside the transaction (TOCTOU protection)
4. **Run guards** — all guards run synchronously; any failure blocks the entire transition
5. Update task status via raw SQL (`UPDATE tasks SET status = ?`)
6. Insert a `transition_history` record
7. Commit the transaction
8. **Run hooks** according to their execution policy (see [Hook Execution Policies](#hook-execution-policies))
9. If any `required` hook fails, roll back the status change transactionally and insert a compensating `transition_history` record
10. Log a `status_change` event to the task event log

**Return type:**

```typescript
interface TransitionResult {
  success: boolean;
  task?: Task;
  error?: string;
  guardFailures?: Array<{ guard: string; reason: string }>;
  hookFailures?: HookFailure[];
}
```

### `getAllTransitions(task)`

Returns all transitions from the task's current status, grouped by trigger type (`manual`, `agent`, `system`). Used by the UI to show available actions.

### `executeForceTransition(task, toStatus, context?)`

Force-transitions a task to any valid status in its pipeline, bypassing guards. Still runs hooks if a matching transition definition exists. Includes TOCTOU protection — verifies the task status has not changed since the caller read it.

### `checkGuards(task, toStatus, trigger, outcome?)`

Runs guards for a transition without executing it (preview mode). Returns `null` if no matching transition exists. The optional `outcome` parameter filters by `agentOutcome`, correctly selecting among multiple agent-triggered transitions that share the same `from`/`to` pair (e.g., `implementing → implementing` self-loops for `failed` vs `conflicts_detected`).

### `retryHook(task, hookName, transition, context?)`

Manually re-runs a single named hook for a given transition. Used when a hook previously failed and the operator wants to retry it without re-executing the full transition.

## TransitionContext

```typescript
interface TransitionContext {
  trigger: TransitionTrigger;          // 'manual' | 'agent' | 'system'
  actor?: string;                       // User or system identifier
  data?: Record<string, unknown>;       // Arbitrary data for hooks
}
```

Common `data` fields used by hooks:
- `agentRunId` — ID of the running agent
- `branch` — git branch name for PR creation
- `payload` — agent outcome payload (e.g., review comments)
- `outcome` — agent outcome type string
- `resumeToStatus` — used by `tryOutcomeTransition` to disambiguate multi-target outcomes (e.g., `info_provided`)

## Hook Execution Policies

Each hook definition includes an optional `policy` field that controls how the engine handles execution and failures. Default policy is `best_effort`.

| Policy | Awaited? | On Failure | Use Case |
|--------|----------|------------|----------|
| `required` | Yes | Roll back status change transactionally; insert compensating `transition_history` record with `_rollback: true` | Critical side-effects like `merge_pr`, `create_prompt`, `push_and_create_pr` |
| `best_effort` | Yes | Log warning; transition still succeeds | Notifications, non-critical updates |
| `fire_and_forget` | No | Log error asynchronously; transition proceeds immediately | Agent startup (`start_agent`), background tasks |

**Rollback behavior for `required` hooks:**

When a `required` hook fails, the engine performs a transactional rollback:
1. Reverts the task status to its original value
2. Inserts a compensating `transition_history` record (with `_rollback: true` in guard_results)
3. Both operations run in a single synchronous `db.transaction()`
4. If the rollback itself fails, the error is logged as a critical event

## Built-in Guards

**File:** `src/core/handlers/core-guards.ts`

| Guard | Logic | Failure Reason |
|-------|-------|----------------|
| `has_pr` | Checks `task.prLink` is truthy | `"Task must have a PR link"` |
| `dependencies_resolved` | Queries `task_dependencies` + pipeline final statuses via `json_each()` | `"{count} unresolved dependencies"` |
| `max_retries` | Counts failed/cancelled `agent_runs`; blocks if count > `params.max` (default 3) | `"Max retries ({max}) reached — {count} failed runs"` |
| `no_running_agent` | Checks for `agent_runs` with `status='running'` | `"An agent is already running for this task"` |
| `has_pending_phases` | Checks task has implementation phases with `status='pending'` | `"No pending phases"` |
| `is_admin` | Checks `context.actor` against the `users` table for admin role | `"Admin access required"` |

Guard signature:

```typescript
type GuardFn = (
  task: Task,
  transition: Transition,
  context: TransitionContext,
  db: Database,
  params?: Record<string, unknown>
) => GuardResult;
```

## Built-in Hooks

Hook signature:

```typescript
type HookFn = (
  task: Task,
  transition: Transition,
  context: TransitionContext,
  params?: Record<string, unknown>
) => Promise<{ success: boolean; error?: string } | void>;
```

### `start_agent` (`src/core/handlers/agent-handler.ts`)

- **Params:** `{ mode: AgentMode, agentType: string, revisionReason?: RevisionReason }` (mode and agentType required)
- **Policy:** Always registered as `fire_and_forget`
- Calls `WorkflowService.startAgent(taskId, mode, agentType, revisionReason, onOutput)` in fire-and-forget mode
- Streams agent output to renderer via IPC push events
- Returns `{ success: true }` immediately before the agent actually starts
- Errors logged to task event log (don't block transition)

### `notify` (`src/core/handlers/notification-handler.ts`)

- **Params:** `{ titleTemplate?: string, bodyTemplate?: string }`
- Defaults: title `"Task update"`, body `"{taskTitle}: {fromStatus} → {toStatus}"`
- Template variables: `{taskTitle}`, `{fromStatus}`, `{toStatus}`
- Routes through `INotificationRouter` (real desktop or stub)

### `create_prompt` (`src/core/handlers/prompt-handler.ts`)

- **Params:** `{ resumeOutcome?: string }`
- **Requires:** `context.data.agentRunId`
- **Policy:** Typically `required` — if prompt creation fails, the transition rolls back
- Creates a pending prompt in the database for human-in-the-loop interaction
- `resumeOutcome` enables automatic transition when the human responds (see [workflow-service.md](./workflow-service.md))

### `merge_pr` (`src/core/handlers/scm-handler.ts`)

- **Policy:** `required` — if merge fails, the transition rolls back
- Fetches the most recent `pr` artifact for the task
- Removes the worktree before merge
- Merges via `scmPlatform.mergePR(prUrl)` (squash + delete-branch)
- Optionally pulls `origin/main` if `project.config.pullMainAfterMerge` is set

### `push_and_create_pr` (`src/core/handlers/scm-handler.ts`)

- **Policy:** `required` — if push/PR creation fails, the transition rolls back
- Resolves worktree path (or project root if no worktree)
- Rebases onto `origin/main` (non-fatal on failure)
- Collects diff and saves as `diff` artifact
- **Skips** push + PR if no changes detected
- Force-pushes with `--force-with-lease` (safe after rebase)
- Creates PR with task title and automated body
- Saves `pr` artifact, updates task `prLink` and `branchName`

### `advance_phase` (`src/core/handlers/phase-handler.ts`)

- **Policy:** `best_effort`
- Marks the current implementation phase as completed
- Activates the next pending phase
- If pending phases remain, triggers a `system` `done → implementing` transition (phase cycling)
- Used on `ready_to_merge → done` alongside `merge_pr`

## Seeded Pipelines

**File:** `src/core/data/seeded-pipelines.ts`

Five pipelines are seeded via migration 011.

### 1. Simple Pipeline (`pipeline-simple`, task type: `simple`)

```
open → in_progress → done
         ↓
       open (reopen)
```

Three statuses, three manual transitions. No guards or hooks.

### 2. Feature Pipeline (`pipeline-feature`, task type: `feature`)

```
backlog → in_progress → in_review → done
                ↓            ↓
             backlog    in_progress (request changes)
```

| From | To | Guards | Hooks |
|------|----|--------|-------|
| `backlog` | `in_progress` | — | — |
| `in_progress` | `in_review` | `has_pr` | — |
| `in_review` | `done` | — | — |
| `in_review` | `in_progress` | — | — |
| `in_progress` | `backlog` | — | — |

All manual triggers.

### 3. Bug Pipeline (`pipeline-bug`, task type: `bug`)

```
reported → investigating → fixing → resolved
                ↓              ↓
             reported    investigating (reopen)
```

| From | To | Guards | Hooks |
|------|----|--------|-------|
| `reported` | `investigating` | — | — |
| `investigating` | `fixing` | — | — |
| `fixing` | `resolved` | — | — |
| `fixing` | `investigating` | — | — |
| `investigating` | `reported` | — | — |

Five statuses (including `resolved`), five manual transitions. No guards or hooks.

### 4. Agent Pipeline (`pipeline-agent`, task type: `agent`)

The main agent-driven workflow with technical design, plan, implement, and review phases.

**Statuses (10):** `open`, `designing`, `design_review`, `planning`, `plan_review`, `implementing`, `pr_review`, `ready_to_merge`, `needs_info`, `done`

**Manual transitions (user-triggered):**

| From | To | Guards | Hooks |
|------|----|--------|-------|
| `open` | `designing` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'designer')` |
| `open` | `planning` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'planner')` |
| `open` | `implementing` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'implementor')` |
| `design_review` | `planning` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'planner')` |
| `design_review` | `implementing` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'implementor')` |
| `design_review` | `designing` | `no_running_agent` | `start_agent(mode: 'revision', agentType: 'designer', revisionReason: 'changes_requested')` |
| `plan_review` | `implementing` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'implementor')` |
| `plan_review` | `planning` | `no_running_agent` | `start_agent(mode: 'revision', agentType: 'planner', revisionReason: 'changes_requested')` |
| `pr_review` | `implementing` | `no_running_agent` | `start_agent(mode: 'revision', agentType: 'implementor', revisionReason: 'changes_requested')` |
| `pr_review` | `ready_to_merge` | — | — |
| `pr_review` | `pr_review` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'reviewer')` |
| `ready_to_merge` | `done` | `is_admin` | `merge_pr` (required), `advance_phase` (best_effort) |
| `done` | `implementing` | `has_pending_phases`, `no_running_agent` | `start_agent(mode: 'new', agentType: 'implementor')` |
| `done` | `ready_to_merge` | — | — (merge retry) |

**Recovery transitions (manual):**

| From | To | Label |
|------|----|-------|
| `planning` | `open` | Cancel Planning |
| `designing` | `open` | Cancel Design |
| `implementing` | `open` | Cancel Implementation |
| `implementing` | `plan_review` | Back to Plan Review |
| `implementing` | `design_review` | Back to Design Review |
| `design_review` | `open` | Cancel Design Review |

**Agent outcome transitions (auto-triggered):**

| From | Outcome | To | Hooks |
|------|---------|----|-------|
| `designing` | `design_ready` | `design_review` | `notify` |
| `designing` | `needs_info` | `needs_info` | `create_prompt(resumeOutcome: 'info_provided')` (required), `notify` |
| `designing` | `failed` | `designing` | `start_agent` (retry, guarded by `max_retries(3)` + `no_running_agent`) |
| `planning` | `plan_complete` | `plan_review` | `notify` |
| `planning` | `needs_info` | `needs_info` | `create_prompt(resumeOutcome: 'info_provided')` (required), `notify` |
| `planning` | `failed` | `planning` | `start_agent` (retry, guarded by `max_retries(3)` + `no_running_agent`) |
| `implementing` | `pr_ready` | `pr_review` | `push_and_create_pr` (required), `notify`, `start_agent(mode: 'new', agentType: 'reviewer')` |
| `implementing` | `needs_info` | `needs_info` | `create_prompt` (required), `notify` |
| `implementing` | `failed` | `implementing` | `start_agent` (retry, guarded) |
| `implementing` | `no_changes` | `open` | — |
| `implementing` | `conflicts_detected` | `implementing` | `start_agent(mode: 'revision', agentType: 'implementor', revisionReason: 'conflicts_detected')` (guarded by `max_retries(3)` + `no_running_agent`) |
| `pr_review` | `approved` | `ready_to_merge` | — |
| `pr_review` | `changes_requested` | `implementing` | `start_agent(mode: 'revision', agentType: 'implementor', revisionReason: 'changes_requested')` |
| `pr_review` | `failed` | `pr_review` | `start_agent(mode: 'new', agentType: 'reviewer')` (retry, guarded) |
| `pr_review` | `pr_ready` | `pr_review` | `push_and_create_pr` (required), `start_agent(mode: 'new', agentType: 'reviewer')` (self-loop retry for PR push) |

**Human-in-the-loop resume (agent-triggered `info_provided`):**

| From | To | Hooks |
|------|----|-------|
| `needs_info` | `planning` | `start_agent(mode: 'revision', agentType: 'planner', revisionReason: 'info_provided')` |
| `needs_info` | `implementing` | `start_agent(mode: 'revision', agentType: 'implementor', revisionReason: 'info_provided')` |
| `needs_info` | `designing` | `start_agent(mode: 'revision', agentType: 'designer', revisionReason: 'info_provided')` |

Note: All three `info_provided` transitions share the same outcome. Disambiguation uses `resumeToStatus` in `context.data` (set by `respondToPrompt`). If no `resumeToStatus` is provided, the first match is used (defaults to `planning`).

**System transitions:**

| From | To | Guards | Hooks |
|------|----|--------|-------|
| `done` | `implementing` | `has_pending_phases`, `no_running_agent` | `start_agent(mode: 'new', agentType: 'implementor')` |

Phase cycling: when `advance_phase` detects remaining pending phases after merge, it fires this system transition to continue implementing the next phase.

### 5. Bug Agent Pipeline (`pipeline-bug-agent`, task type: `bug-agent`)

Agent-driven bug investigation and fix workflow.

**Statuses (10):** `reported`, `investigating`, `investigation_review`, `designing`, `design_review`, `implementing`, `pr_review`, `ready_to_merge`, `needs_info`, `done`

The flow adds an investigation phase before design/implementation:
`reported → investigating → investigation_review → [designing → design_review →] implementing → pr_review → ready_to_merge → done`

**Manual transitions:**

| From | To | Guards | Hooks |
|------|----|--------|-------|
| `reported` | `investigating` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'investigator')` |
| `reported` | `implementing` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'implementor')` |
| `investigation_review` | `implementing` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'implementor')` |
| `investigation_review` | `designing` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'designer')` |
| `investigation_review` | `investigating` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'investigator')` |
| `design_review` | `implementing` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'implementor')` |
| `design_review` | `designing` | `no_running_agent` | `start_agent(mode: 'revision', agentType: 'designer', revisionReason: 'changes_requested')` |
| `pr_review` | `implementing` | `no_running_agent` | `start_agent(mode: 'revision', agentType: 'implementor', revisionReason: 'changes_requested')` |
| `pr_review` | `ready_to_merge` | — | — |
| `pr_review` | `pr_review` | `no_running_agent` | `start_agent(mode: 'new', agentType: 'reviewer')` |
| `ready_to_merge` | `done` | `is_admin` | `merge_pr` (required), `advance_phase` (best_effort) |
| `done` | `implementing` | `has_pending_phases`, `no_running_agent` | `start_agent(mode: 'new', agentType: 'implementor')` |
| `done` | `ready_to_merge` | — | — (merge retry) |

**Recovery transitions (manual):**

| From | To | Label |
|------|----|-------|
| `investigating` | `reported` | Cancel Investigation |
| `designing` | `reported` | Cancel Design |
| `implementing` | `reported` | Cancel Implementation |
| `implementing` | `investigation_review` | Back to Investigation Review |
| `implementing` | `design_review` | Back to Design Review |
| `design_review` | `reported` | Cancel Design Review |

**Agent outcome transitions** mirror the Agent Pipeline with the following additions:
- `investigating → investigation_review` on `investigation_complete`
- `investigating → investigating` on `failed` (retry, guarded)
- `investigating → needs_info` on `needs_info`
- `needs_info → investigating` on `info_provided` (with `start_agent(mode: 'revision', agentType: 'investigator', revisionReason: 'info_provided')`)
- `implementing → reported` on `no_changes` (instead of `open`)

## Outcome-Driven Transitions

When an agent completes, `AgentService` calls `tryOutcomeTransition(taskId, outcome, data)`:

1. Fetch the task's current state
2. Get valid transitions filtered by `trigger: 'agent'`
3. Filter transitions where `agentOutcome` matches the agent's reported outcome
4. If `resumeToStatus` is provided in `data`, prefer the candidate matching that target status
5. If multiple candidates exist without `resumeToStatus`, log a warning and use the first match
6. If found, execute the transition (which triggers guards and hooks)

This creates the autonomous loop: agent completes -> outcome transition -> hooks fire next agent -> repeat.

### Self-Loop Disambiguation

Multiple self-loop transitions can share the same `from`/`to` pair but different outcomes (e.g., `implementing → implementing` for both `failed` and `conflicts_detected`). `executeTransition` disambiguates by matching `ctx.data.outcome` against `transition.agentOutcome`.

The `pr_ready` self-loop on `pr_review → pr_review` is similarly disambiguated from the `failed` self-loop on the same pair.

### Human-in-the-Loop

When an agent reports `needs_info`:
1. Outcome transition creates a prompt via `create_prompt` hook with `resumeOutcome: 'info_provided'`
2. Human answers the prompt via `WorkflowService.respondToPrompt()`
3. `respondToPrompt` finds the matching transition by `agentOutcome === resumeOutcome` and passes `resumeToStatus` to select the correct `info_provided` target
4. The hook on that transition starts the next agent in the appropriate resume mode

## Outcome Schemas

**File:** `src/core/handlers/outcome-schemas.ts`

**With payloads:**

| Outcome | Required Fields |
|---------|-----------------|
| `needs_info` | `questions: array` |
| `options_proposed` | `summary: string`, `options: array` |
| `changes_requested` | `summary: string`, `comments: array` |

**Signal-only (no payload):**

`plan_complete`, `investigation_complete`, `pr_ready`, `approved`, `design_ready`, `reproduced`, `cannot_reproduce`, `failed`, `no_changes`, `info_provided`, `conflicts_detected`

## Type Definitions

```typescript
interface Transition {
  from: string;                     // Source status (or '*' wildcard)
  to: string;                       // Target status
  trigger: TransitionTrigger;       // 'manual' | 'agent' | 'system'
  guards?: TransitionGuard[];
  hooks?: TransitionHook[];
  label?: string;                   // UI label for manual transitions
  agentOutcome?: string;            // Outcome value for agent-triggered transitions
}

interface TransitionGuard {
  name: string;
  params?: Record<string, unknown>;
}

interface TransitionHook {
  name: string;
  params?: Record<string, unknown>;
  policy?: HookExecutionPolicy;     // 'required' | 'best_effort' | 'fire_and_forget'
}

type HookExecutionPolicy = 'required' | 'best_effort' | 'fire_and_forget';
```

## Edge Cases

- **Self-transitions** are used for retry loops: `planning → planning` on `failed` outcome, guarded by `max_retries`. Also used for `conflicts_detected` (resolve conflicts) and `pr_ready` on `pr_review` (PR push retry).
- **`no_changes` outcome** overrides the normal flow: `implementing → open` instead of `pr_review`, skipping PR creation entirely.
- **Guards run synchronously** inside a better-sqlite3 transaction — they cannot be async. The `dependencies_resolved` guard uses raw SQL with `json_each()` to inspect pipeline statuses.
- **Hook failure behavior depends on policy** — `required` hooks trigger a transactional rollback with compensating history record; `best_effort` hooks log warnings; `fire_and_forget` hooks log errors asynchronously.
- **Wildcard source** (`from: '*'`) allows transitions from any status, useful for recovery paths.
- **TOCTOU protection** — both `executeTransition` and `executeForceTransition` re-fetch the task inside a synchronous transaction and verify the status has not changed since the caller read it.
- The `pr_ready` outcome is verified by `AgentService` — it checks the branch actually has changes via `git diff`. If no changes exist, the outcome is overridden to `no_changes`.
- **Phase cycling** — after merge, `advance_phase` marks the current phase done and triggers `done → implementing` if more phases remain. This loop continues until all phases are complete.
- **`info_provided` multi-target routing** — three `info_provided` transitions exist (to `planning`, `implementing`, `designing`). `tryOutcomeTransition` uses `resumeToStatus` from `context.data` to select the correct target. A warning is logged if multiple candidates exist without a `resumeToStatus`.
