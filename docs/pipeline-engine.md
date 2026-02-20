# Pipeline Engine

State machine, transitions, guards, hooks, and seeded pipelines.

## Core Concepts

A **Pipeline** defines a set of statuses and the transitions between them. Each task is bound to exactly one pipeline.

- **Status** — a named state (e.g., `open`, `implementing`, `pr_review`) with a label, color, and optional `isFinal` flag
- **Transition** — a directed edge from one status to another, with a trigger type, optional guards, and optional hooks
- **Trigger** — who can fire the transition: `manual` (user), `agent` (outcome-driven), or `system`
- **Guard** — synchronous check that can block a transition (e.g., "task must have a PR link")
- **Hook** — asynchronous side-effect that runs after a successful transition (e.g., "start an agent")

## PipelineEngine Implementation

**File:** `src/main/services/pipeline-engine.ts`

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
4. **Run guards** — all guards run synchronously; first failure blocks the entire transition
5. Update task status via raw SQL (`UPDATE tasks SET status = ?`)
6. Insert a `transition_history` record
7. Commit the transaction
8. **Run hooks** asynchronously (fire-and-forget). Hook failures are logged but do not roll back.
9. Log a `status_change` event to the task event log

**Return type:**

```typescript
interface TransitionResult {
  success: boolean;
  task?: Task;
  error?: string;
  guardFailures?: Array<{ guard: string; reason: string }>;
}
```

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

## Built-in Guards

**File:** `src/main/handlers/core-guards.ts`

| Guard | Logic | Failure Reason |
|-------|-------|----------------|
| `has_pr` | Checks `task.prLink` is truthy | `"Task must have a PR link"` |
| `dependencies_resolved` | Queries `task_dependencies` + pipeline final statuses via `json_each()` | `"{count} unresolved dependencies"` |
| `max_retries` | Counts failed/cancelled `agent_runs`; blocks if count > `params.max` (default 3) | `"Max retries ({max}) reached — {count} failed runs"` |
| `no_running_agent` | Checks for `agent_runs` with `status='running'` | `"An agent is already running for this task"` |

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
  context: TransitionContext
) => Promise<void>;
```

### `start_agent` (`src/main/handlers/agent-handler.ts`)

- **Params:** `{ mode: AgentMode, agentType: string }` (both required)
- Calls `WorkflowService.startAgent(taskId, mode, agentType, onOutput)` in fire-and-forget mode
- Streams agent output to renderer via IPC push events
- Errors logged to task event log (don't block transition)

### `notify` (`src/main/handlers/notification-handler.ts`)

- **Params:** `{ titleTemplate?: string, bodyTemplate?: string }`
- Defaults: title `"Task update"`, body `"{taskTitle}: {fromStatus} → {toStatus}"`
- Template variables: `{taskTitle}`, `{fromStatus}`, `{toStatus}`
- Routes through `INotificationRouter` (real desktop or stub)

### `create_prompt` (`src/main/handlers/prompt-handler.ts`)

- **Params:** `{ resumeOutcome?: string }`
- **Requires:** `context.data.agentRunId`
- Creates a pending prompt in the database for human-in-the-loop interaction
- `resumeOutcome` enables automatic transition when the human responds (see [workflow-service.md](./workflow-service.md))

### `merge_pr` (`src/main/handlers/scm-handler.ts`)

- Fetches the most recent `pr` artifact for the task
- Removes the worktree before merge
- Merges via `scmPlatform.mergePR(prUrl)` (squash + delete-branch)
- Optionally pulls `origin/main` if `project.config.pullMainAfterMerge` is set

### `push_and_create_pr` (`src/main/handlers/scm-handler.ts`)

- Resolves worktree path (or project root if no worktree)
- Rebases onto `origin/main` (non-fatal on failure)
- Collects diff and saves as `diff` artifact
- **Skips** push + PR if no changes detected
- Force-pushes with `--force-with-lease` (safe after rebase)
- Creates PR with task title and automated body
- Saves `pr` artifact, updates task `prLink` and `branchName`

## Seeded Pipelines

**File:** `src/main/data/seeded-pipelines.ts`

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

Guard `has_pr` on `in_progress → in_review`. All manual triggers.

### 3. Bug Pipeline (`pipeline-bug`, task type: `bug`)

```
reported → investigating → fixing → resolved
                ↓              ↓
             reported    investigating (reopen)
```

Four statuses, four manual transitions. No guards or hooks.

### 4. Agent Pipeline (`pipeline-agent`, task type: `agent`)

The main agent-driven workflow with plan, implement, and review phases.

**Statuses:** `open`, `planning`, `plan_review`, `implementing`, `pr_review`, `needs_info`, `done`

**Manual transitions (user-triggered):**

| From | To | Guards | Hooks |
|------|----|--------|-------|
| `open` | `planning` | `no_running_agent` | `start_agent(mode: 'plan', agentType: 'claude-code')` |
| `open` | `implementing` | `no_running_agent` | `start_agent(mode: 'implement', agentType: 'claude-code')` |
| `plan_review` | `implementing` | `no_running_agent` | `start_agent(mode: 'implement', agentType: 'claude-code')` |
| `plan_review` | `planning` | `no_running_agent` | `start_agent(mode: 'plan_revision', agentType: 'claude-code')` |
| `pr_review` | `implementing` | `no_running_agent` | `start_agent(mode: 'request_changes', agentType: 'claude-code')` |
| `pr_review` | `done` | — | `merge_pr` |

**Agent outcome transitions (auto-triggered):**

| From | Outcome | To | Hooks |
|------|---------|----|-------|
| `planning` | `plan_complete` | `plan_review` | `notify` |
| `planning` | `needs_info` | `needs_info` | `create_prompt(resumeOutcome: 'info_provided')`, `notify` |
| `planning` | `failed` | `planning` | `start_agent` (retry, guarded by `max_retries(3)` + `no_running_agent`) |
| `implementing` | `pr_ready` | `pr_review` | `push_and_create_pr`, `notify`, `start_agent(mode: 'review', agentType: 'pr-reviewer')` |
| `implementing` | `needs_info` | `needs_info` | `create_prompt`, `notify` |
| `implementing` | `failed` | `implementing` | `start_agent` (retry, guarded) |
| `implementing` | `no_changes` | `open` | — |
| `needs_info` | `info_provided` | `planning` or `implementing` | `start_agent` (resumes previous mode) |
| `pr_review` | `approved` | `done` | `merge_pr` |
| `pr_review` | `changes_requested` | `implementing` | `start_agent(mode: 'request_changes')` |
| `pr_review` | `failed` | `pr_review` | `start_agent(mode: 'review')` (retry, guarded) |

### 5. Bug Agent Pipeline (`pipeline-bug-agent`, task type: `bug-agent`)

Similar to the Agent Pipeline but starts with investigation.

**Statuses:** `reported`, `investigating`, `investigation_review`, `implementing`, `pr_review`, `needs_info`, `done`

The flow adds an investigation phase: `reported → investigating → investigation_review → implementing → pr_review → done`. Outcome transitions mirror the Agent Pipeline with `investigate` mode replacing `plan` mode.

## Outcome-Driven Transitions

When an agent completes, `AgentService` calls `tryOutcomeTransition(taskId, outcome, data)`:

1. Fetch the task's current state
2. Get valid transitions filtered by `trigger: 'agent'`
3. Find a transition where `agentOutcome` matches the agent's reported outcome
4. If found, execute the transition (which triggers guards and hooks)

This creates the autonomous loop: agent completes → outcome transition → hooks fire next agent → repeat.

### Human-in-the-Loop

When an agent reports `needs_info`:
1. Outcome transition creates a prompt via `create_prompt` hook with `resumeOutcome: 'info_provided'`
2. Human answers the prompt via `WorkflowService.respondToPrompt()`
3. `respondToPrompt` finds the matching transition by `agentOutcome === resumeOutcome` and executes it
4. The hook on that transition starts the next agent

## Outcome Schemas

**File:** `src/main/handlers/outcome-schemas.ts`

**With payloads:**

| Outcome | Required Fields |
|---------|-----------------|
| `needs_info` | `questions: array` |
| `options_proposed` | `summary: string`, `options: array` |
| `changes_requested` | `summary: string`, `comments: array` |

**Signal-only (no payload):**

`plan_complete`, `investigation_complete`, `pr_ready`, `approved`, `design_ready`, `reproduced`, `cannot_reproduce`, `failed`, `no_changes`, `info_provided`

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
}
```

## Edge Cases

- **Self-transitions** are used for retry loops: `planning → planning` on `failed` outcome, guarded by `max_retries`.
- **`no_changes` outcome** overrides the normal flow: `implementing → open` instead of `pr_review`, skipping PR creation entirely.
- **Guards run synchronously** inside a better-sqlite3 transaction — they cannot be async. The `dependencies_resolved` guard uses raw SQL with `json_each()` to inspect pipeline statuses.
- **Hook failures don't rollback** — the status change is already committed. Failures are logged as warnings in the task event log.
- **Wildcard source** (`from: '*'`) allows transitions from any status, useful for recovery paths.
- The `pr_ready` outcome is verified by `AgentService` — it checks the branch actually has changes via `git diff`. If no changes exist, the outcome is overridden to `no_changes`.
