# Phase 2: Agent Execution + Git/SCM

**Goal:** Run Claude Code agents on tasks with worktree isolation, artifact collection, and full lifecycle — all testable via ScriptedAgent.

**Dependencies:** Phase 1

---

## What Gets Built

### Interfaces
- `IAgent` — Single agent adapter (execute, stop, stream output)
- `IAgentFramework` — Agent registry, discovery, instantiation
- `IAgentRunStore` — Agent run CRUD, status tracking
- `IWorktreeManager` — Git worktree lifecycle (create/lock/unlock/cleanup)
- `IGitOps` — Branch, commit, push, pull, diff via git CLI
- `IScmPlatform` — PR create/merge via `gh` CLI (GitHub)

### Agent Adapters
- `ClaudeCodeAgent` — Claude Code SDK adapter
- `ScriptedAgent` — Test agent with pre-built scripts

### Core Services
- **AgentService** — Full 10-step agent lifecycle:
  1. Prepare environment (worktree, branch)
  2. Assemble context (task metadata, project info, plan, previous output)
  3. Configure agent (model, timeout, system prompt)
  4. Execute agent
  5. Monitor (stream output, check health)
  6. Parse result (exit code, outcome, payload)
  7. Validate result (payload schema)
  8. Collect artifacts (branch, PR, commit, diff)
  9. Trigger pipeline transition (based on outcome)
  10. Cleanup (unlock worktree)

- **WorkflowService** — THE single entry point for all operations:
  - `createTask()`, `updateTask()`, `deleteTask()`
  - `transitionTask()` — manual transitions
  - `startAgent()`, `stopAgent()`
  - `respondToPrompt()` — human-in-the-loop prompt response
  - `mergePR()` — merge PR and transition to done

- **WorktreeManager** — Git worktree isolation:
  - `create(branch, taskId)` — create worktree for task
  - `lock(taskId)` — prevent concurrent access
  - `unlock(taskId)` — release lock
  - `cleanup()` — remove stale worktrees

- **GitOps** — Git CLI operations:
  - Branch creation, checkout, push, pull
  - Commit, diff, log
  - PATH resolution for git binary

- **ScmPlatform** — GitHub via `gh` CLI:
  - `createPR(branch, title, body)` — create pull request
  - `mergePR(prUrl)` — merge pull request
  - `getPRStatus(prUrl)` — check PR status

### Additional Features
- File-system sandbox tool hook
- Config resolution: agent defaults < global < project < hook params < per-run
- Timeout watchdog + cancellation
- TaskSupervisor background loop (health checks)
- Task artifacts store (branch, PR, commit, diff, document)
- Task phases support (multi-phase tasks: plan → implement → review)
- Prompt lifecycle: pending_prompts store, respond flow
- Notification router scaffold (Promise.allSettled, desktop channel only)

### ScriptedAgent (for testing)
Pre-built scripts:
- `happyPlan` — Simulates successful planning, returns `plan_complete`
- `happyImplement` — Simulates successful implementation, returns `pr_ready`
- `happyReview` — Simulates successful review, returns `approved`
- `failAfterSteps(n)` — Fails after N steps, returns `failed`
- `humanInTheLoop` — Returns `needs_info` with questions payload

### E2E Tests
- Full agent lifecycle with ScriptedAgent
- Artifact collection (branch, PR, commit created)
- Pipeline auto-transitions (agent outcome triggers transition)
- Prompt/response flow (needs_info → info_provided → resume)
- Multi-phase tasks (plan → implement)
- Error scenarios:
  - Hook failure during transition
  - Artifact collection failure
  - Agent timeout
  - Agent crash

---

## Database Tables (4)

### `agent_runs`
```sql
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  mode TEXT CHECK(mode IN ('plan','implement','review')),
  status TEXT CHECK(status IN ('running','completed','failed','timed_out','cancelled')),
  output TEXT,
  outcome TEXT,
  payload TEXT,                 -- JSON transition payload
  exit_code INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  cost_input_tokens INTEGER,
  cost_output_tokens INTEGER,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE INDEX idx_agent_runs_task_id ON agent_runs(task_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
```

### `task_artifacts`
```sql
CREATE TABLE task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  type TEXT CHECK(type IN ('branch','pr','commit','diff','document')),
  data TEXT NOT NULL,           -- JSON artifact data
  created_at INTEGER NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id)
);
CREATE INDEX idx_task_artifacts_task_id ON task_artifacts(task_id);
```

### `task_phases`
```sql
CREATE TABLE task_phases (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  phase TEXT NOT NULL,          -- "plan" | "implement" | "review"
  status TEXT CHECK(status IN ('pending','active','completed','failed')),
  agent_run_id TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY(task_id) REFERENCES tasks(id),
  FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id)
);
CREATE INDEX idx_task_phases_task_id ON task_phases(task_id);
```

### `pending_prompts`
```sql
CREATE TABLE pending_prompts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_run_id TEXT NOT NULL,
  prompt_type TEXT NOT NULL,    -- "needs_info" | "options_proposed" | "changes_requested"
  payload TEXT NOT NULL,        -- JSON prompt payload
  response TEXT,                -- JSON response payload (null until answered)
  status TEXT CHECK(status IN ('pending','answered','expired')),
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  FOREIGN KEY(task_id) REFERENCES tasks(id),
  FOREIGN KEY(agent_run_id) REFERENCES agent_runs(id)
);
CREATE INDEX idx_pending_prompts_task_id ON pending_prompts(task_id);
CREATE INDEX idx_pending_prompts_status ON pending_prompts(status);
```

---

## Key Interfaces

```typescript
interface IAgent {
  readonly type: string
  execute(context: AgentContext, config: AgentConfig): Promise<AgentRunResult>
  stop(runId: string): Promise<void>
  isAvailable(): Promise<boolean>
}

interface IAgentFramework {
  getAgent(type: string): IAgent
  listAgents(): AgentInfo[]
  getAvailableAgents(): Promise<AgentInfo[]>
}

interface IAgentRunStore {
  createRun(data: CreateAgentRunInput): Promise<AgentRun>
  updateRun(id: string, data: UpdateAgentRunInput): Promise<AgentRun>
  getRun(id: string): Promise<AgentRun | null>
  getRunsForTask(taskId: string): Promise<AgentRun[]>
  getActiveRuns(): Promise<AgentRun[]>
}

interface IWorktreeManager {
  create(branch: string, taskId: string): Promise<Worktree>
  get(taskId: string): Promise<Worktree | null>
  list(): Promise<Worktree[]>
  lock(taskId: string): Promise<void>
  unlock(taskId: string): Promise<void>
  delete(taskId: string): Promise<void>
  cleanup(): Promise<void>
}

interface IGitOps {
  createBranch(name: string, baseBranch?: string): Promise<void>
  checkout(branch: string): Promise<void>
  push(branch: string, force?: boolean): Promise<void>
  pull(branch: string): Promise<void>
  diff(fromRef: string, toRef?: string): Promise<string>
  commit(message: string): Promise<string>
  log(count?: number): Promise<GitLogEntry[]>
  getCurrentBranch(): Promise<string>
}

interface IScmPlatform {
  createPR(params: CreatePRParams): Promise<PRInfo>
  mergePR(prUrl: string): Promise<void>
  getPRStatus(prUrl: string): Promise<PRStatus>
}

interface AgentRunResult {
  exitCode: number
  output: string
  outcome?: string         // "plan_complete" | "pr_ready" | "needs_info" | "failed" etc.
  payload?: TransitionPayload
  error?: string
  costInputTokens?: number
  costOutputTokens?: number
}

interface AgentContext {
  task: Task
  project: Project
  workdir: string          // worktree path
  mode: "plan" | "implement" | "review"
  previousOutput?: string
  payloadResponses?: PayloadResponse[]
  systemPrompt?: string
}
```

---

## File Structure

```
src/main/
  interfaces/
    agent.ts
    agent-framework.ts
    agent-run-store.ts
    worktree-manager.ts
    git-ops.ts
    scm-platform.ts
  stores/
    sqlite-agent-run-store.ts
    sqlite-pending-prompt-store.ts
    sqlite-task-artifact-store.ts
    sqlite-task-phase-store.ts
  agents/
    claude-code-agent.ts
    scripted-agent.ts
  services/
    workflow-service.ts
    agent-service.ts
    agent-context-builder.ts
    worktree-manager-impl.ts
    git-ops-cli.ts
    github-scm-platform.ts
    task-supervisor.ts
    notification-router.ts
  providers/
    setup.ts               -- updated with new services

tests/
  helpers/
    scripted-agent.ts
  e2e/
    agent-lifecycle.test.ts
    artifact-collection.test.ts
    pipeline-auto-transition.test.ts
    prompt-response-flow.test.ts
    multi-phase-tasks.test.ts
    error-scenarios.test.ts
```

---

## User Can
Run full agent lifecycle tests. Manually run `ClaudeCodeAgent` on a task via a test script.
