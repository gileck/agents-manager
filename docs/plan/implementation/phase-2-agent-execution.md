# Phase 2: Agent Execution

## Goal

Integrate AI agent execution into the task manager. Users can run Claude Code SDK on a task in plan-only or implement mode, see real-time streaming output, and track agent run history.

By the end of this phase, users can:
- Click "Plan" on a task to have an agent produce an implementation plan
- Click "Implement" on a task to have an agent write code
- Watch agent output stream in real time
- Stop a running agent
- View history of all agent runs per task and per project
- Configure agent settings (model, max turns, etc.)

---

## Database Schema (new tables)

### `agent_runs` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| task_id | TEXT | FK → tasks.id |
| project_id | TEXT | FK → projects.id |
| agent_type | TEXT | 'claude-code' (only option in Phase 2) |
| mode | TEXT | 'plan' or 'implement' |
| status | TEXT | 'running', 'completed', 'failed', 'cancelled', 'timed_out' |
| model | TEXT | Model used (e.g., 'claude-sonnet-4-5-20250929') |
| transcript | TEXT | Full agent output (JSON array of messages) |
| error | TEXT | Error message if failed (nullable) |
| token_usage | TEXT | JSON: { inputTokens, outputTokens, totalCost } (nullable) |
| duration_ms | INTEGER | How long the run took |
| started_at | TEXT (ISO) | Start timestamp |
| finished_at | TEXT (ISO) | End timestamp (nullable) |

**Note:** Agent configuration is **not** stored in the database. It lives on disk via `config.json` files:
- **Global defaults:** `~/.agents-manager/config.json` (agents section)
- **Per-project overrides:** `<project>/.agents-manager/config.json` (agents section)

See `architecture/agent-platform.md` for the full config merge chain.

---

## Types

```typescript
type AgentType = 'claude-code';
type AgentRunMode = 'plan' | 'implement';
type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out';

interface AgentRun {
  id: string;
  taskId: string;
  projectId: string;
  agentType: AgentType;
  mode: AgentRunMode;
  status: AgentRunStatus;
  model: string;
  transcript: AgentMessage[];
  error: string | null;
  tokenUsage: { inputTokens: number; outputTokens: number; totalCost: number } | null;
  durationMs: number;
  startedAt: string;
  finishedAt: string | null;
}

interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  // For assistant messages with tool use
  toolUse?: { name: string; input: any; output: any }[];
}

interface AgentConfig {
  agentType: AgentType;
  model: string;             // default: 'claude-sonnet-4-5-20250929'
  maxTurns: number;          // default: 50
  timeout: number;           // default: 600000 (10 min)
  systemPrompt: string;      // additional system prompt to prepend
  autoCommit: boolean;       // default: true
  branchStrategy: 'new-per-task' | 'shared' | 'current'; // default: 'new-per-task'
  branchPrefix: string;      // default: 'agent/'

  // Auto-retry on failure
  retry: {
    enabled: boolean;            // default: true
    maxRetries: number;          // default: 3
    delayBetweenRetries: number; // ms, default: 30000 (30s)
    backoffMultiplier: number;   // default: 2 (30s → 60s → 120s)
    timeoutPerAttempt: number;   // ms, default: 600000 (10 min)
    retryOn: ('timeout' | 'crash' | 'rate_limit' | 'all')[]; // default: ['all']
  };
}
```

---

## IPC Channels

### Agent Execution

| Channel | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `agent:start` | renderer → main | { taskId, mode, configOverrides? } | { runId } |
| `agent:stop` | renderer → main | { runId } | void |
| `agent:status` | renderer → main | { runId } | AgentRun |
| `agent:output` | main → renderer | { runId, message: AgentMessage } | (event stream) |
| `agent:completed` | main → renderer | { runId, status, tokenUsage? } | (event) |

### Agent Runs (history)

| Channel | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `agent-runs:list` | renderer → main | { projectId?, taskId? } | AgentRun[] |
| `agent-runs:get` | renderer → main | { id } | AgentRun |
| `agent-runs:delete` | renderer → main | { id } | void |

### Agent Config

| Channel | Direction | Payload | Response |
|---------|-----------|---------|----------|
| `agent-config:get` | renderer → main | { projectPath?, agentType } | AgentConfig |
| `agent-config:save` | renderer → main | { projectPath?, agentType, config } | AgentConfig |

---

## Agent Execution Flow

### Starting an Agent

1. User clicks "Plan" or "Implement" on a task
2. Renderer sends `agent:start` with taskId and mode
3. Main process:
   a. Creates an `agent_runs` record with status='running'
   b. Updates task status to 'planning' or 'in_progress'
   c. **Creates or reuses a git worktree** for the task's branch via `IWorktreeManager`
   d. Constructs the agent prompt from task data (via `AgentContextBuilder`)
   e. Spawns Claude Code SDK subprocess with `cwd` set to the **worktree path** (not the main repo)
   f. Locks the worktree (`worktreeManager.lock()`)
   g. Returns { runId } to renderer
4. Main process streams output via `agent:output` events
5. On completion/failure:
   a. Sends `agent:completed` event
   b. Unlocks the worktree (`worktreeManager.unlock()`)
   c. Worktree is kept for review/retry; cleaned up when task reaches terminal status

**Key:** The main repo working directory is never touched by agents. Each agent works in its own worktree, allowing multiple agents on different tasks in the same project to run simultaneously without conflicts.

### Prompt Construction

For **plan mode:**
```
You are working on the project at: {project.path}

Task: {task.title}
Description: {task.description}
Priority: {task.priority}
Size: {task.size}
Complexity: {task.complexity}

Your job is to analyze this task and create a detailed implementation plan.
Do NOT write any code. Only produce a plan.

The plan should include:
- Files to create/modify
- Key changes in each file
- Order of implementation
- Potential risks or edge cases
- Estimated number of steps

Output the plan in markdown format.
```

For **implement mode:**
```
You are working on the project at: {project.path}

Task: {task.title}
Description: {task.description}
Priority: {task.priority}
Size: {task.size}
Complexity: {task.complexity}

{task.plan ? `Implementation Plan:\n${task.plan}` : ''}

Implement this task. Write the code, create/modify files as needed.
{config.autoCommit ? 'Commit your changes when done.' : 'Do not commit.'}
{config.branchStrategy === 'new-per-task' ? `Create and work on branch: ${config.branchPrefix}${task.id}` : ''}
```

### Claude Code SDK Integration

```typescript
// Using @anthropic-ai/claude-code SDK
import { claude } from '@anthropic-ai/claude-code';

class ClaudeCodeAgent {
  async run(options: {
    projectPath: string;
    prompt: string;
    model: string;
    maxTurns: number;
    onMessage: (message: AgentMessage) => void;
    abortSignal: AbortSignal;
  }): Promise<{ transcript: AgentMessage[]; tokenUsage: TokenUsage }> {
    const result = await claude({
      prompt: options.prompt,
      cwd: options.projectPath,
      model: options.model,
      maxTurns: options.maxTurns,
      abortSignal: options.abortSignal,
      onMessage: (msg) => {
        options.onMessage(convertToAgentMessage(msg));
      }
    });

    return {
      transcript: result.messages.map(convertToAgentMessage),
      tokenUsage: extractTokenUsage(result)
    };
  }
}
```

### After Plan Completes

- Store the plan output in `tasks.plan` field
- Update task status to 'planned'
- User can view the plan on the task detail page
- User can edit the plan before running implement

### After Implement Completes

- Update task status to 'pr_review' (via pipeline transition)
- Create branch artifact and PR artifact on the task
- User reviews from task detail page, clicks **Merge & Complete** when ready
- Merge button calls `IScmPlatform.mergePR()` → auto-transitions to Done

---

## Agent Context Assembly

When an agent resumes after a human-in-the-loop pause, it needs the full conversation history. The `AgentContextBuilder` assembles the prompt from multiple sources:

### Context Sources (in order)

1. **Task metadata** — title, description, priority, size, complexity, tags
2. **Plan** — the current plan (if exists)
3. **Task artifacts** — branches, PRs, relevant links
4. **Payload history** — Q&A exchanges, selected options, review comments (from event log)
5. **Previous agent run summary** — what the last agent did, what failed, what succeeded
6. **Latest payload response** — the specific input that triggered this resumption

### Implementation

```typescript
class AgentContextBuilder {
  async build(taskId: string, mode: AgentRunMode): Promise<string> {
    const task = await this.taskStore.getTask(taskId);
    const artifacts = await this.taskStore.listArtifacts(taskId);
    const events = await this.eventLog.list(taskId, {
      category: ['payload', 'agent', 'transition'],
    });

    const sections: string[] = [];

    // 1. Task metadata
    sections.push(this.buildTaskSection(task));

    // 2. Plan
    if (task.plan) {
      sections.push(`## Implementation Plan\n${task.plan}`);
    }

    // 3. Artifacts
    if (artifacts.length > 0) {
      sections.push(this.buildArtifactsSection(artifacts));
    }

    // 4. Conversation history (payload exchanges)
    const payloadEvents = events.filter(e => e.category === 'payload');
    if (payloadEvents.length > 0) {
      sections.push(this.buildConversationHistory(payloadEvents));
    }

    // 5. Previous run summary
    const agentEvents = events.filter(e => e.category === 'agent');
    if (agentEvents.length > 0) {
      sections.push(this.buildPreviousRunSummary(agentEvents));
    }

    // 6. Mode-specific instructions
    sections.push(this.buildModeInstructions(mode));

    return sections.join('\n\n---\n\n');
  }
}
```

This ensures agents never lose context across pause/resume cycles. The event log acts like a GitHub issue thread — all communication is preserved chronologically.

---

## Structured Output for Payloads

Agents communicate structured data back to the pipeline using **structured output** — a standard feature in agent frameworks like Claude Code SDK.

### How It Works

1. `AgentContextBuilder` reads `OUTCOME_SCHEMAS` to determine which outcomes are possible from the current status
2. Agent prompt includes the available outcomes and their payload schemas (from the registry)
3. Agent returns a named outcome + optional structured JSON payload
4. Agent adapter parses the output, validates the payload against `OUTCOME_SCHEMAS[outcome].schema`
5. If validation fails → treated as `agent_error` (bad output)
6. If valid → `AgentService.onAgentCompleted()` passes the outcome + payload to the pipeline engine

```typescript
interface AgentRunResult {
  transcript: AgentMessage[];
  tokenUsage?: TokenUsage;
  exitCode: number;
  outcome?: string;              // named outcome from OUTCOME_SCHEMAS (only when exitCode === 0)
  payload?: TransitionPayload;   // validated against OUTCOME_SCHEMAS[outcome].schema
  error?: string;                // error message when exitCode !== 0
}
```

### Outcome Schema Registry

All outcome→payload mappings are defined in a single file: `src/main/handlers/outcome-schemas.ts`. This is the **single source of truth** for what data each outcome carries. See **`../architecture/pipeline/outcome-schemas.md`** for the full registry definition.

Each outcome either:
- **Has a JSON Schema** (e.g., `needs_info` requires `{ questions: [...] }`) — agent must return matching payload
- **Has no schema** (`schema: null`, e.g., `pr_ready`, `plan_complete`) — signal-only, no payload needed

The registry provides `validateOutcomePayload(outcome, payload)` used by the engine at transition time.

### Agent Prompt Assembly

The `AgentContextBuilder` dynamically builds prompt instructions from the schema registry:

```
When you finish, return one of these outcomes:
- outcome: "pr_ready" (no payload needed)
- outcome: "needs_info" with payload matching: { questions: [{ id, question, context?, inputType?, options? }] }
- outcome: "changes_requested" with payload matching: { summary, comments: [{ file?, line?, severity, comment }] }
```

This keeps agent prompts in sync with the schema — add a new outcome to `OUTCOME_SCHEMAS` and agents automatically learn about it.

---

## Task Artifacts

Tasks accumulate artifacts over their lifecycle. These are displayed on the task detail page and used by pipeline hooks.

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type TEXT NOT NULL,          -- 'branch', 'pull_request', 'commit', 'diff', 'link'
  label TEXT NOT NULL,
  url TEXT,
  metadata TEXT DEFAULT '{}',  -- JSON, type-specific data
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_task_artifacts_task ON task_artifacts(task_id);
CREATE INDEX idx_task_artifacts_type ON task_artifacts(type);
```

### When Artifacts Are Created

| Event | Artifact Type | Created By |
|-------|--------------|------------|
| Agent creates branch | `branch` | system (via `create_branch` hook) |
| Agent creates PR | `pull_request` | system (via agent adapter) |
| Agent makes commits | `commit` | system (via agent adapter) |
| Admin links external resource | `link` | user |
| PR is merged | `pull_request` updated (state→merged) | system (via `merge_pr` hook) |

### Merge Button Flow

On the task detail page when task is in `pr_review`:

```
┌─────────────────────────────────────────────────┐
│ Artifacts                                        │
│                                                  │
│ 🌿 Branch: agent/task-123                        │
│ 🔗 PR #45: "Add authentication middleware"  [Open]│
│    +142 / -23 across 5 files                     │
│ 📝 3 commits                                     │
│                                                  │
│ [✅ Merge & Complete]  [❌ Request Changes]       │
└─────────────────────────────────────────────────┘
```

**Merge & Complete** triggers:
1. Pipeline guard checks `has_pr` (PR artifact exists with state=open)
2. `merge_pr` hook calls `IScmPlatform.mergePR()`
3. Artifact updated: state → merged
4. Task transitions to `done`
5. Event log records: "PR #45 merged, task completed"

---

## Pages & Components

### Task Detail - Updated

Add to the existing task detail page:

```
┌─────────────────────────────────────────────────┐
│ Task Title                          Status: Open │
│                                                  │
│ [▶ Plan] [▶ Implement] [⏹ Stop]                │
│                                                  │
│ ... (existing metadata, description) ...         │
├─────────────────────────────────────────────────┤
│ Plan                                    [Edit]   │
│ (rendered markdown of the plan)                  │
├─────────────────────────────────────────────────┤
│ Agent Runs                                       │
│ ┌─────────────────────────────────────────────┐ │
│ │ Run #3 - Implement - Completed - 2m 34s     │ │
│ │ Run #2 - Plan - Completed - 45s             │ │
│ │ Run #1 - Plan - Failed - 12s                │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**New components:**
- `AgentControls` - Plan/Implement/Stop buttons with state awareness
- `AgentRunList` - list of runs for this task
- `PlanEditor` - editable markdown view of the plan

### Agent Run Detail (`/projects/:id/agents/:runId`)

**Purpose:** Full transcript of an agent run.

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ ← Back          Run #3 - Task: "Add auth"       │
│ Status: Completed │ Duration: 2m 34s │ Cost: $0.12│
├─────────────────────────────────────────────────┤
│ ┌─ User ─────────────────────────────────────┐  │
│ │ Implement the login page with...           │  │
│ └────────────────────────────────────────────┘  │
│ ┌─ Assistant ────────────────────────────────┐  │
│ │ I'll start by creating the LoginPage...    │  │
│ │ [Tool: Write] src/pages/Login.tsx          │  │
│ │ [Tool: Write] src/api/auth.ts              │  │
│ └────────────────────────────────────────────┘  │
│ ┌─ Assistant ────────────────────────────────┐  │
│ │ Now let me add the route...                │  │
│ └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Components:**
- `TranscriptViewer` - renders the full conversation
- `TranscriptMessage` - single message bubble (user/assistant/system)
- `ToolUseBlock` - collapsible block showing tool name, input, output
- `RunStatusBar` - status, duration, cost, model info

### Agent Runs Page (`/projects/:id/agents`)

**Purpose:** History of all agent runs for the project.

**Components:**
- `AgentRunsTable` - table with columns: task, mode, status, duration, cost, date
- Filters: by status, mode, task

### Live Output Panel

When an agent is running, show a live output panel:
- Can be shown inline on the task detail page
- Or as a slide-out panel from the right
- Streams messages as they arrive
- Auto-scrolls to bottom
- "Stop" button prominently visible

---

## Main Process Services

### `AgentService`

```typescript
class AgentService {
  // Track running agents
  private runningAgents: Map<string, { controller: AbortController; runId: string }>;

  start(taskId: string, mode: AgentRunMode, configOverrides?: Partial<AgentConfig>): string // returns runId
  stop(runId: string): void
  getStatus(runId: string): AgentRun

  // Subscribe to events (for IPC forwarding)
  onOutput(runId: string, callback: (message: AgentMessage) => void): void
  onCompleted(runId: string, callback: (run: AgentRun) => void): void
}
```

### `AgentRunService`

```typescript
class AgentRunService {
  list(filters: { projectId?: string; taskId?: string }): AgentRun[]
  getById(id: string): AgentRun
  delete(id: string): void
}
```

### `AgentConfigService`

Reads and writes agent configuration from disk-based `config.json` files (not from the database).

```typescript
class AgentConfigService {
  // Merges: hardcoded defaults → global file → project file
  get(projectPath: string | null, agentType: AgentType): AgentConfig
  // Writes to ~/.agents-manager/config.json (global) or <project>/.agents-manager/config.json (project)
  save(projectPath: string | null, agentType: AgentType, config: Partial<AgentConfig>): AgentConfig
}
```

### `TaskSupervisor`

Background health loop that runs on an interval in the main process. This is the safety net — catches dead agents, stuck tasks, and orphaned retries.

```typescript
class TaskSupervisor {
  private interval: NodeJS.Timeout | null = null;

  start(config: SupervisorConfig): void    // begin interval loop
  stop(): void                              // clear interval (app quit)
  async runOnce(): Promise<SupervisorReport> // single scan (for testing / manual trigger)
}

interface SupervisorReport {
  checkedAt: string;
  deadAgents: number;       // processes killed and retried/failed
  timedOutAgents: number;   // agents past timeout
  stuckWaiting: number;     // reminder notifications sent
  orphanedRetries: number;  // retries re-scheduled
  activeNoAgent: number;    // warnings sent
}
```

**Lifecycle:** Started in `src/main/index.ts` after provider setup. Stopped on `app.on('before-quit')`. Config read from settings (global `SupervisorConfig`).

**Checks per tick:**
1. Query all `agent_runs` with `status=running` → verify OS process alive (via PID) → kill + retry/fail if dead
2. Query all `agent_runs` running > timeout → kill process tree → retry/fail
3. Query all tasks in `waiting` category > 24h → send reminder via notification router
4. Query scheduled retries past their delay → execute now (handles app restart mid-delay)
5. Query tasks in `active` category with no running agent > threshold → send warning
6. Cleanup stale worktrees → `worktreeManager.cleanup()` removes worktrees for tasks in terminal status (done/cancelled)

All actions logged to task event log with `supervisor.*` event types.

---

## Settings - Updated

Add to Settings page:

**Agent Configuration section:**
- Model picker (claude-opus-4-6, claude-sonnet-4-5-20250929, claude-haiku-4-5-20251001)
- Max turns (number input)
- Timeout (number input, in seconds)
- Auto-commit toggle
- Branch strategy (dropdown)
- Branch prefix (text input)
- Custom system prompt (textarea)

**Auto-Retry section:**
- Enabled toggle (default: on)
- Max retries (default: 3)
- Initial delay (default: 30 seconds)
- Backoff multiplier (default: 2x)
- Timeout per attempt (default: 10 minutes)
- Retry on: checkboxes for Timeout, Crash, Rate Limit

**Task Supervisor section:**
- Enabled toggle (default: on)
- Check interval (default: 60 seconds)
- Agent timeout override (default: use per-agent config)
- Waiting task reminder after (default: 24 hours)
- Active-no-agent warning after (default: 10 minutes)

Can be set globally or per-project (project settings override global).

---

## Migration (Phase 2)

```sql
-- Migration 004: Create agent_runs table
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL DEFAULT 'claude-code',
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  model TEXT NOT NULL,
  transcript TEXT DEFAULT '[]',
  error TEXT,
  token_usage TEXT,
  duration_ms INTEGER DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX idx_agent_runs_task ON agent_runs(task_id);
CREATE INDEX idx_agent_runs_project ON agent_runs(project_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
```

---

## Deliverables Checklist

- [ ] Database migrations (agent_runs, task_artifacts)
- [ ] IWorktreeManager interface + LocalWorktreeManager implementation
- [ ] Worktree lifecycle (create on agent start, lock/unlock, cleanup on task done)
- [ ] Claude Code SDK integration (spawn in worktree, stream, cancel)
- [ ] AgentService (start, stop, stream output)
- [ ] AgentRunService (history CRUD)
- [ ] AgentConfigService (get/save configs from disk-based config.json files)
- [ ] AgentContextBuilder (assemble full context for agent prompts)
- [ ] Structured output parsing (agent output → TransitionPayload)
- [ ] IPC handlers for agent execution, history, and artifacts
- [ ] Prompt construction (plan mode + implement mode + resume-with-context)
- [ ] Task detail: Plan/Implement/Stop buttons
- [ ] Task detail: plan viewer/editor
- [ ] Task detail: agent run history list
- [ ] Task detail: artifacts panel (branches, PRs, commits)
- [ ] Task detail: Merge & Complete button (calls IScmPlatform.mergePR)
- [ ] Agent Run Detail page (transcript viewer)
- [ ] Agent Runs page (project-level history)
- [ ] Live output streaming panel
- [ ] Settings: agent configuration section
- [ ] Auto-update task status on agent start/complete/fail
- [ ] Store plan output on task after plan mode completes
- [ ] Failed agent → transition to failed status with recovery options
- [ ] TaskSupervisor background loop (dead agents, timeouts, stuck tasks, orphaned retries)
- [ ] Settings: supervisor configuration (interval, thresholds, enable/disable)
