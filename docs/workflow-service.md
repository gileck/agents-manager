# Workflow Service

Central orchestration, activity logging, and prompt handling.

## Role

`WorkflowService` is the central orchestration layer. All business operations — task CRUD, transitions, agent management, prompt handling — go through this service. It enforces activity logging, worktree cleanup, and cross-cutting concerns.

**File:** `src/main/services/workflow-service.ts`
**Interface:** `src/main/interfaces/workflow-service.ts`

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

### `resetTask(id: string): Promise<Task | null>`

Resets a task to its initial state (see [task-management.md](./task-management.md) for details).

1. Calls `cleanupWorktree(task)`
2. Resets status, plan, subtasks, planComments, prLink, branchName
3. Cascade deletes: context entries, prompts, phases, artifacts, runs, events, transition history
4. Activity: `action='reset', entityType='task', summary="Reset task: {title}"`

### `transitionTask(taskId: string, toStatus: string, actor?: string): Promise<TransitionResult>`

Executes a pipeline transition with `trigger: 'manual'`.

1. Calls `pipelineEngine.executeTransition(task, toStatus, { trigger: 'manual', actor })`
2. Activity: `action='transition', summary="Transitioned task from {from} to {to}"`
3. If the target status is final (`isFinal: true`), calls `cleanupWorktree(task)`

### `startAgent(taskId: string, mode: AgentMode, agentType?: string, onOutput?): Promise<AgentRun>`

Starts an agent in fire-and-forget mode.

- Default `agentType`: `'claude-code'`
- Activity: `action='agent_start', entityType='agent_run', summary="Starting {agentType} agent in {mode} mode"`

### `stopAgent(runId: string): Promise<void>`

Stops a running agent.

- Activity: `action='agent_complete', entityType='agent_run', summary="Agent stopped"`

### `respondToPrompt(promptId: string, response: Record<string, unknown>): Promise<PendingPrompt | null>`

Answers a pending prompt and optionally triggers an auto-transition.

1. Calls `pendingPromptStore.answerPrompt(promptId, response)`
2. Activity: `action='prompt_response', summary="Responded to agent prompt"`
3. Task event: `category='agent', message="Prompt answered: {promptType}"`
4. **Auto-transition (resume flow):**
   - If `prompt.resumeOutcome` is set:
     - Gets valid transitions for the task with `trigger: 'agent'`
     - Finds transition where `agentOutcome === prompt.resumeOutcome`
     - If found: executes the transition (which may trigger hooks like `start_agent`)
     - If not found: logs a warning event

### `mergePR(taskId: string): Promise<void>`

Merges the most recent PR for a task.

1. Gets `pr` artifacts for task, takes the last one
2. Creates `GitHubScmPlatform` for the project path
3. Calls `scmPlatform.mergePR(prUrl)`
4. Activity: `action='transition', summary="Merged PR: {prUrl}"`
5. Tries to transition task to a final status (finds first manual transition to a final state)

### `getDashboardStats(): Promise<DashboardStats>`

Returns aggregate stats:
- `projectCount` — total projects
- `totalTasks` — total tasks
- `tasksByStatus` — map of status → count
- `activeAgentRuns` — count of running agents
- `recentActivityCount` — activity entries in the last 24 hours

## Prompt Response and Resume Flow

The resume flow connects human answers to automatic pipeline progression:

```
Agent reports needs_info
    ↓
Transition: implementing → needs_info
    ↓
Hook: create_prompt(resumeOutcome: 'info_provided')
    ↓
PendingPrompt created in DB with:
  - promptType: 'needs_info'
  - resumeOutcome: 'info_provided'
  - status: 'pending'
    ↓
Human answers via respondToPrompt(promptId, response)
    ↓
Prompt marked 'answered'
    ↓
WorkflowService finds transition where agentOutcome === 'info_provided'
    ↓
Executes transition: needs_info → implementing
    ↓
Hook: start_agent(mode: 'implement') fires
    ↓
Agent resumes with human's answer as context
```

## Activity Logging

Every `WorkflowService` method logs to the `activity_log` table with:

| Field | Description |
|-------|-------------|
| `action` | `create`, `update`, `delete`, `reset`, `transition`, `agent_start`, `agent_complete`, `prompt_response` |
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
2. If project has no `path` → return (no cleanup possible)
3. Create worktree manager for project path
4. Get worktree for `task.id`
5. If worktree exists:
   - Unlock if locked
   - Delete the worktree
6. Try to delete the remote branch via `gitOps.deleteRemoteBranch(branch)`

## Edge Cases

- **`transitionTask` uses `trigger: 'manual'` only.** Agent-triggered transitions are handled internally by `AgentService.tryOutcomeTransition()`, not through the workflow service's public API.
- **IPC handler strips `status`** from update payloads. The `TASK_UPDATE` IPC handler removes the `status` field before calling `workflowService.updateTask()` to force all status changes through `transitionTask()`.
- **`respondToPrompt` can fail to find a matching transition** when `resumeOutcome` is set but no transition's `agentOutcome` matches the outcome from the current task status. This is logged as a warning event on the task timeline but does not throw.
- **`mergePR` takes the most recent PR artifact** — `artifacts[artifacts.length - 1]`. If a task has multiple PR artifacts (from retries), only the latest is used.
- **Worktree cleanup is best-effort** — all exceptions during cleanup are caught and ignored. This prevents cleanup failures from blocking task deletion or status transitions.
