---
title: Workflow Service
description: Central orchestration, activity logging, and prompt handling
summary: WorkflowService is the single entry point for all business operations — task CRUD, transitions, agent management, prompt handling. All daemon route handlers delegate to it.
priority: 2
key_points:
  - "File: src/core/services/workflow-service.ts"
  - "Interface: src/core/interfaces/workflow-service.ts"
  - "All business logic goes here — never in IPC handlers, CLI commands, or daemon route handlers"
---
# Workflow Service

Central orchestration, activity logging, and prompt handling.

## Role

`WorkflowService` is the central orchestration layer. All business operations — task CRUD, transitions, agent management, prompt handling — go through this service. It enforces activity logging, worktree cleanup, and cross-cutting concerns.

**File:** `src/core/services/workflow-service.ts`
**Interface:** `src/core/interfaces/workflow-service.ts`

**Exception:** `PROJECT_CREATE`, `PROJECT_UPDATE`, and `PROJECT_DELETE` route handlers call `projectStore` directly, bypassing WorkflowService. This is by design — project CRUD has no cross-cutting concerns (no worktree cleanup, no pipeline transitions). No activity logging occurs for project mutations.

## Full API Surface

### `createTask(input: TaskCreateInput): Promise<Task>`

Creates a task and logs activity.

- Determines default status from the pipeline's first status if not provided
- Activity: `action='create', entityType='task', summary="Created task: {title}"`

### `updateTask(id: string, input: TaskUpdateInput): Promise<Task | null>`

Updates task fields and logs activity. Returns null if task not found.

- Activity: `action='update', entityType='task', summary="Updated task: {title}"`

### `deleteTask(id: string): Promise<boolean>`

Deletes a task with full cleanup.

1. Fetches task (to get project reference)
2. Calls `cleanupWorktree(task)` — unlocks worktree, deletes worktree, deletes remote branch
3. Deletes task record (cascade deletes related data)
4. Activity: `action='delete', entityType='task', summary="Deleted task: {id}"`

### `resetTask(id: string, pipelineId?: string): Promise<Task | null>`

Resets a task to its initial state (see [task-management.md](./task-management.md) for details).

- **`pipelineId`** (optional): When provided, switches the task to a different pipeline during the reset. The new pipeline is validated before proceeding. The task's status is reset to the first status of the target pipeline.

1. Checks no agent is running (throws if one is)
2. Validates the new pipeline if `pipelineId` is provided
3. Calls `cleanupWorktree(task)`
4. Resets status, plan, subtasks, planComments, prLink, branchName
5. Cascade deletes: context entries, prompts, phases, artifacts, runs, events, transition history
6. Activity: `action='reset', entityType='task', summary="Reset task: {title}"` (includes old/new pipeline in data when pipeline changes)

### `transitionTask(taskId: string, toStatus: string, actor?: string): Promise<TransitionResult>`

Executes a pipeline transition with `trigger: 'manual'`.

1. Calls `pipelineEngine.executeTransition(task, toStatus, { trigger: 'manual', actor })`
2. Activity: `action='transition', summary="Transitioned task from {from} to {to}"`
3. If the target status is final (`isFinal: true`), calls `cleanupWorktree(task)`

### `forceTransitionTask(taskId: string, toStatus: string, actor?: string): Promise<TransitionResult>`

Force-transitions a task to any status, bypassing all pipeline guards.

- Uses `pipelineEngine.executeForceTransition()` which skips guard checks entirely
- Activity: `action='transition', summary="Force-transitioned task from {from} to {to}"` with `data.forced: true`
- **Does NOT call `cleanupWorktree`** on final states (unlike `transitionTask`). This is intentional — force transitions are escape hatches and should not trigger side effects.

### `startAgent(taskId: string, mode: AgentMode, agentType: string, revisionReason?: RevisionReason, onOutput?, onMessage?, onStatusChange?): Promise<AgentRun>`

Starts an agent in fire-and-forget mode.

- **`mode`**: `'new'` or `'revision'`
- **`agentType`**: `'planner'`, `'designer'`, `'implementor'`, `'investigator'`, `'reviewer'`, `'task-workflow-reviewer'`
- **`revisionReason`**: optional `'changes_requested'`, `'info_provided'`, or `'conflicts_detected'` (only when mode is `'revision'`)
- **`onOutput`** callback receives raw output chunks (streamed to renderer)
- **`onMessage`** callback receives structured `AgentChatMessage` objects
- **`onStatusChange`** callback receives agent status updates
- Activity: `action='agent_start', entityType='agent_run', summary="Starting {agentType} agent in {mode} mode"`

### `resumeAgent(taskId, message, callbacks): Promise<AgentRun | null>`

Queues a user message and conditionally starts a new agent if none is running.

1. Queues the message via `agentService.queueMessage()` (the running agent picks it up, or a new agent receives it on first turn)
2. Checks for a running agent — if one exists, returns `null` (message was queued, no new agent needed)
3. Derives `mode` and `agentType` from the most recent run for this task (defaults to `'new'` / `'implementor'`)
4. When resuming a revision run, sets `revisionReason: 'info_provided'`
5. Calls `startAgent()` with the derived parameters and provided callbacks

This method consolidates the "send message to agent" business logic that was previously in the IPC handler.

### `stopAgent(runId: string): Promise<void>`

Stops a running agent.

- Activity: `action='agent_complete', entityType='agent_run', summary="Agent stopped"`

### `respondToPrompt(promptId: string, response: Record<string, unknown>): Promise<PendingPrompt | null>`

Answers a pending prompt and optionally triggers an auto-transition.

1. Calls `pendingPromptStore.answerPrompt(promptId, response)`
2. Activity: `action='prompt_response', summary="Responded to agent prompt"`
3. Task event: `category='agent', message="Prompt answered: {promptType}"`
4. Stores Q&A as a task context entry (`entryType: 'user_input'`) so the resumed agent sees the human's answer
5. **Auto-transition (resume flow):**
   - If `prompt.resumeOutcome` is set:
     - Gets valid transitions for the task with `trigger: 'agent'`
     - If `payload.resumeToStatus` is set, prefers a transition matching both `agentOutcome` and target status
     - Falls back to first transition matching `agentOutcome === prompt.resumeOutcome`
     - If found: executes the transition (which may trigger hooks like `start_agent`)
     - If not found: logs a warning event

### `getPipelineDiagnostics(taskId: string): Promise<PipelineDiagnostics | null>`

Returns comprehensive diagnostic data for a task's pipeline state. Used by the pipeline inspector UI.

**Five diagnostic areas:**

1. **Status metadata** — label, category, isFinal, color for the current status
2. **All transitions** — grouped by trigger (manual/agent/system), with guard pre-checks for manual transitions
3. **Recent hook failures** — scans task events from the last 24 hours for system errors/warnings that reference a hook name. Each failure includes whether it is retryable (retryable hooks: `merge_pr`, `push_and_create_pr`, `advance_phase`, `delete_worktree`)
4. **Agent state** — whether an agent is running, last run status/error, total failed runs
5. **Stuck detection** — identifies two stuck scenarios:
   - Task is in an `agent_running` phase but no agent is running (with a 30-second grace window after agent completion to avoid false positives during finalization)
   - Task is in a terminal status with pending phases and a failed `advance_phase` hook

Independent queries (transitions, events, agent runs) are executed in parallel via `Promise.all`.

### `retryHook(taskId: string, hookName: string, transitionFrom?: string, transitionTo?: string): Promise<HookRetryResult>`

Retries a previously failed hook.

**Two-pass search algorithm:**
1. **Exact match** — if `transitionFrom` and `transitionTo` are provided, searches for a transition matching those statuses (including wildcard `*` for `from`) that contains the specified hook
2. **Fallback** — if no exact match, searches all transitions in the pipeline for any transition containing the hook

**Retryable hooks:** `merge_pr`, `push_and_create_pr`, `advance_phase`, `delete_worktree`

On success: Activity `action='system', summary="Retried hook \"{hookName}\" successfully"`

### `advancePhase(taskId: string): Promise<TransitionResult>`

Manually triggers phase advancement for a multi-phase task.

**Two code paths:**

1. **Primary** — finds a system transition from the current status that has an `advance_phase` hook, then executes it. This is the normal path where the pipeline defines an explicit `advance_phase` hook on a system transition.
2. **Fallback** — if no transition with an `advance_phase` hook exists, finds any system transition from the current status and executes it. This handles pipelines where phase advancement is implicit in the system transition.

On success: Activity `action='transition', summary="Manually advanced phase for task"`

On failure (no matching transition): logs a warning to the task event log with the pipeline ID and current status, then returns `{ success: false }`.

### `mergePR(taskId: string): Promise<TransitionResult>`

Merges the most recent PR for a task. Returns a `TransitionResult` indicating success or failure (does not throw).

1. Gets `pr` artifacts for task, takes the last one
2. Creates `GitHubScmPlatform` for the project path
3. Calls `scmPlatform.mergePR(prUrl)` — errors are caught and returned as `{ success: false, error: ... }`
4. Activity: `action='transition', summary="Merged PR: {prUrl}"`
5. Tries to transition task to a final status (finds first manual transition to a final state)

### `getDashboardStats(now?: number): Promise<DashboardStats>`

Returns aggregate stats using SQL aggregation (`GROUP BY status`) for performance.

- **`now`** (optional): injectable timestamp for deterministic testing. Defaults to `Date.now()`.
- All queries are parallelized via `Promise.all`: project count, task total, status counts, active runs, recent activity

Returns:
- `projectCount` — total projects
- `totalTasks` — total tasks (via `COUNT(*)`, not array length)
- `tasksByStatus` — map of status to count (via `GROUP BY`)
- `activeAgentRuns` — count of running agents
- `recentActivityCount` — activity entries in the last 24 hours

## Prompt Response and Resume Flow

The resume flow connects human answers to automatic pipeline progression:

```
Agent reports needs_info
    |
Transition: implementing -> needs_info
    |
Hook: create_prompt(resumeOutcome: 'info_provided')
    |
PendingPrompt created in DB with:
  - promptType: 'needs_info'
  - resumeOutcome: 'info_provided'
  - status: 'pending'
    |
Human answers via respondToPrompt(promptId, response)
    |
Prompt marked 'answered'
    |
Q&A stored as task context entry (user_input)
    |
WorkflowService finds transition where agentOutcome === 'info_provided'
    |
Executes transition: needs_info -> implementing
    |
Hook: start_agent(mode: 'revision', agentType: 'implementor', revisionReason: 'info_provided') fires
    |
Agent resumes with human's answer as context
```

## Activity Logging

Every `WorkflowService` method logs to the `activity_log` table with:

| Field | Description |
|-------|-------------|
| `action` | `create`, `update`, `delete`, `reset`, `transition`, `agent_start`, `agent_complete`, `prompt_response`, `system` |
| `entityType` | `task`, `project`, `agent_run` |
| `entityId` | ID of the affected entity |
| `projectId` | Project ID (when available from the task) |
| `summary` | Human-readable description |
| `data` | Additional context (fromStatus, toStatus, agentType, mode, etc.) |

Activity entries include `projectId` for scoped filtering on the dashboard.

## Worktree Cleanup

**Private method:** `cleanupWorktree(task: Task): Promise<void>`

Called in three scenarios:
1. **On `deleteTask`** — before task deletion
2. **On `resetTask`** — before state reset
3. **On `transitionTask`** — after successful transition to a final status

**Steps (all best-effort, errors caught and ignored):**

1. Get project by `task.projectId`
2. If project has no `path` -> return (no cleanup possible)
3. Create worktree manager for project path
4. Get worktree for `task.id`
5. If worktree exists:
   - Unlock if locked
   - Delete the worktree
6. Try to delete the remote branch via `gitOps.deleteRemoteBranch(branch)`

## Edge Cases

- **`transitionTask` uses `trigger: 'manual'` only.** Agent-triggered transitions are handled internally by `AgentService.tryOutcomeTransition()`, not through the workflow service's public API.
- **Route handler strips `status`** from update payloads. The `TASK_UPDATE` IPC handler removes the `status` field before calling `workflowService.updateTask()` to force all status changes through `transitionTask()`.
- **`respondToPrompt` can fail to find a matching transition** when `resumeOutcome` is set but no transition's `agentOutcome` matches the outcome from the current task status. This is logged as a warning event on the task timeline but does not throw.
- **`mergePR` takes the most recent PR artifact** — `artifacts[artifacts.length - 1]`. If a task has multiple PR artifacts (from retries), only the latest is used.
- **Worktree cleanup is best-effort** — all exceptions during cleanup are caught and ignored. This prevents cleanup failures from blocking task deletion or status transitions.
- **`forceTransitionTask` does NOT clean up worktrees** — unlike `transitionTask`, force transitions skip worktree cleanup even on final states.
- **Project CRUD bypasses WorkflowService** — `PROJECT_CREATE`, `PROJECT_UPDATE`, and `PROJECT_DELETE` route handlers call `projectStore` directly. This is an intentional exception to the single-entry-point principle.
