---
title: Agent System
description: Agent types, execution lifecycle, prompts, validation, and context accumulation
summary: "Agent architecture: Agent class combines a PromptBuilder (domain logic) with an AgentLib (engine logic) resolved from AgentLibRegistry. Role-based prompt builders: PlannerPromptBuilder, DesignerPromptBuilder, ImplementorPromptBuilder, InvestigatorPromptBuilder, ReviewerPromptBuilder. ScriptedAgent is the test mock."
priority: 2
key_points:
  - "File: src/core/agents/ — Agent, PlannerPromptBuilder, DesignerPromptBuilder, ImplementorPromptBuilder, InvestigatorPromptBuilder, ReviewerPromptBuilder, ScriptedAgent"
  - "File: src/core/libs/ — ClaudeCodeLib, CursorAgentLib, CodexCliLib"
  - "Agent resolves AgentLib from registry via config.engine at execute() time"
  - "Prompt templates: DB-backed via PromptRenderer, or hardcoded in prompt builder classes"
---
# Agent System

Agent types, execution lifecycle, prompts, validation, and context accumulation.

## Architecture

```
AgentLibRegistry                           Prompt Builders (domain logic)
┌─────────────────────────────────┐        ┌───────────────────────────────────────────┐
│ IAgentLib interface             │        │ BaseAgentPromptBuilder                    │
│  ├── ClaudeCodeLib  (SDK)       │        │  ├── PlannerPromptBuilder                 │
│  ├── CursorAgentLib (CLI)       │        │  ├── DesignerPromptBuilder                │
│  └── CodexCliLib    (CLI)       │        │  ├── ImplementorPromptBuilder             │
└─────────────────────────────────┘        │  ├── InvestigatorPromptBuilder            │
                │                          │  ├── ReviewerPromptBuilder                │
                │                          │  └── TaskWorkflowReviewerPromptBuilder    │
                │                          └───────────────────────────────────────────┘
                │                                          │
                └──────────► Agent(type, promptBuilder, registry) ◄─┘
                             implements IAgent
                             resolves lib from registry per execute()
```

**Agent** is the single generic production `IAgent` implementation. It takes a `type`, a `BaseAgentPromptBuilder`, and an `AgentLibRegistry`. At execute() time, it reads `config.engine` to resolve the right `IAgentLib`, delegates prompt building to the prompt builder, and delegates execution to the lib.

### Engine Selection

Each agent definition in the database has an `engine` field (`claude-code`, `cursor-agent`, or `codex-cli`). `AgentService` passes `engine` via `AgentConfig`, and `Agent` resolves the matching `IAgentLib` from the `AgentLibRegistry` at execution time.

## Agent Hierarchy

```
IAgent (interface)
  └── Agent (PromptBuilder + AgentLibRegistry → IAgent)
        ├── PlannerPromptBuilder        — plan creation and revision
        ├── DesignerPromptBuilder       — technical design creation and revision
        ├── ImplementorPromptBuilder    — implementation, request_changes, resolve_conflicts
        ├── InvestigatorPromptBuilder   — bug investigation
        ├── ReviewerPromptBuilder       — code review with verdict extraction
        └── TaskWorkflowReviewerPromptBuilder — task workflow review
  └── ScriptedAgent                     — test mock with pre-written scripts
```

**File locations:**

Libs (engine logic):
- `src/core/interfaces/agent-lib.ts` — `IAgentLib` interface and types
- `src/core/libs/claude-code-lib.ts` — Claude SDK engine
- `src/core/libs/cursor-agent-lib.ts` — Cursor CLI engine
- `src/core/libs/codex-cli-lib.ts` — Codex CLI engine
- `src/core/services/agent-lib-registry.ts` — Engine registry

Prompt builders (domain logic):
- `src/core/agents/base-agent-prompt-builder.ts` — `BaseAgentPromptBuilder` abstract base
- `src/core/agents/planner-prompt-builder.ts` — `PlannerPromptBuilder`
- `src/core/agents/designer-prompt-builder.ts` — `DesignerPromptBuilder`
- `src/core/agents/implementor-prompt-builder.ts` — `ImplementorPromptBuilder`
- `src/core/agents/investigator-prompt-builder.ts` — `InvestigatorPromptBuilder`
- `src/core/agents/reviewer-prompt-builder.ts` — `ReviewerPromptBuilder`
- `src/core/agents/task-workflow-reviewer-prompt-builder.ts` — `TaskWorkflowReviewerPromptBuilder`
- `src/core/agents/prompt-utils.ts` — Shared interactive field/instruction helpers

Agent:
- `src/core/agents/agent.ts` — `Agent` class (generic, resolves lib from registry)
- `src/core/interfaces/agent.ts` — `IAgent` interface
- `src/core/agents/scripted-agent.ts` — `ScriptedAgent` (test mock, implements IAgent directly)

### IAgent Interface

```typescript
export interface IAgent {
  readonly type: string;
  execute(
    context: AgentContext,
    config: AgentConfig,
    onOutput?: (chunk: string) => void,
    onLog?: (message: string, data?: Record<string, unknown>) => void,
    onPromptBuilt?: (prompt: string) => void,
    onMessage?: (msg: AgentChatMessage) => void,
  ): Promise<AgentRunResult>;
  stop(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

### IAgentLib Interface

```typescript
export interface AgentLibFeatures {
  images: boolean;   // supports base64 image content blocks
  hooks: boolean;    // supports preToolUse hook interception
  thinking: boolean; // supports thinking/reasoning blocks
}

export interface IAgentLib {
  readonly name: string;
  supportedFeatures(): AgentLibFeatures;
  execute(runId: string, options: AgentLibRunOptions, callbacks: AgentLibCallbacks): Promise<AgentLibResult>;
  stop(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
  getTelemetry(runId: string): AgentLibTelemetry | null;
}
```

Feature support by lib:
- `ClaudeCodeLib`: `{ images: true, hooks: true, thinking: true }`
- `CursorAgentLib`: `{ images: false, hooks: false, thinking: false }`
- `CodexCliLib`: `{ images: false, hooks: false, thinking: false }`

### BaseAgentPromptBuilder

Abstract base class that handles prompt assembly (template resolution, task context prepending, skills appending) and result construction.

Key abstract methods:
- `buildPrompt(context: AgentContext): string` — mode-specific prompt
- `inferOutcome(mode: string, exitCode: number, output: string): string` — outcome from exit code

Overridable methods:
- `isReadOnly(_context: AgentContext): boolean` — default `false`; builders override to return `true` for read-only agents (planner, investigator, reviewer)
- `getMaxTurns(context): number` — default 100
- `getOutputFormat(context): object | undefined` — JSON schema for structured output
- `getTimeout(context, config): number` — default 10 minutes

### Agent

The generic `Agent` class bridges prompt builder + lib registry → `IAgent`:
1. Calls `promptBuilder.buildExecutionConfig()` to get prompt, schema, timeouts
2. Resolves `IAgentLib` from `AgentLibRegistry` using `config.engine` (default: `'claude-code'`)
3. Calls `lib.execute()` with the config
4. Calls `promptBuilder.inferOutcome()` and `promptBuilder.buildResult()` on the result
5. Polls `lib.getTelemetry()` every 500ms for live cost/progress reporting
6. Tracks active libs per runId in a `Map` so `stop()` can delegate to the correct lib

### PlannerPromptBuilder

`type: 'planner'`

- `isReadOnly() = true`
- Max turns: 150, Timeout: 10 min
- Handles plan creation (`mode: 'new'`) and plan revision/resume (`mode: 'revision'`)
- `inferOutcome()` → `'plan_complete'`
- Structured output: `{ plan, planSummary, subtasks, phases }` + interactive fields
- When `revisionReason === 'changes_requested'`: includes plan feedback in prompt
- When `revisionReason === 'info_provided'`: includes user answers in prompt

### DesignerPromptBuilder

`type: 'designer'`

- `isReadOnly() = false` (may create scaffolding)
- Max turns: 150, Timeout: 10 min
- Handles technical design creation (`mode: 'new'`) and design revision/resume (`mode: 'revision'`)
- `inferOutcome()` → `'design_ready'`
- Structured output: `{ technicalDesign, designSummary }` + interactive fields

### ImplementorPromptBuilder

`type: 'implementor'`

- `isReadOnly() = false`
- `inferOutcome()` → `'pr_ready'`
- Only handles implementation, request changes, and conflict resolution

| Mode | RevisionReason | Max Turns | Timeout | Output Schema |
|------|----------------|-----------|---------|---------------|
| `new` | — | 200 | 30 min | `{ summary }` + interactive fields |
| `revision` | `changes_requested` | 200 | 30 min | `{ summary }` |
| `revision` | `conflicts_detected` | 50 | 10 min | `{ summary }` |
| `revision` | `info_provided` | 200 | 30 min | `{ summary }` + interactive fields |

### InvestigatorPromptBuilder

`type: 'investigator'`

- `isReadOnly() = true`
- Max turns: 150, Timeout: 10 min
- Handles bug investigation (`mode: 'new'`) and investigation resume (`mode: 'revision'`)
- Includes `task.debugInfo` (raw debug logs) in the prompt when present — this field is only consumed by the investigator, keeping downstream agent prompts clean
- `inferOutcome()` → `'investigation_complete'`
- Structured output: `{ plan, investigationSummary, subtasks }` + interactive fields

### ReviewerPromptBuilder

`type: 'reviewer'`

- `isReadOnly() = true`
- Max turns: 50
- Uses structured output with JSON schema for verdict extraction
- Returns `{ verdict, summary, comments }` via structured output
- Returns payload `{ summary, comments }` for the `changes_requested` outcome

### TaskWorkflowReviewerPromptBuilder

`type: 'task-workflow-reviewer'`

- Max turns: 50
- Default timeout: 5 minutes
- Reviews task execution workflow quality and efficiency
- Structured output includes `overallVerdict`, `executionSummary`, `findings`, `promptImprovements`, `processImprovements`, `tokenCostAnalysis`

### ScriptedAgent

Test-only agent with a configurable script function. Built-in test scripts:
- `happyPlan` — returns `plan_complete`
- `happyImplement` — returns `pr_ready`
- `happyReview` — returns `approved`
- `failAfterSteps(n)` — fails after n calls
- `humanInTheLoop` — returns `needs_info`

## Agent Modes

```typescript
type AgentMode = 'new' | 'revision';
type RevisionReason = 'changes_requested' | 'info_provided' | 'conflicts_detected';
```

Agent runs are identified by the combination of `agentType`, `mode`, and optionally `revisionReason`:

| Agent Type | Mode | RevisionReason | Purpose | Default Outcome |
|-----------|------|----------------|---------|----------------|
| `planner` | `new` | — | Create implementation plan | `plan_complete` |
| `planner` | `revision` | `changes_requested` | Revise plan based on admin feedback | `plan_complete` |
| `planner` | `revision` | `info_provided` | Resume plan with user answers | `plan_complete` |
| `designer` | `new` | — | Create technical design | `design_ready` |
| `designer` | `revision` | `changes_requested` | Revise design based on feedback | `design_ready` |
| `designer` | `revision` | `info_provided` | Resume design with user answers | `design_ready` |
| `implementor` | `new` | — | Code implementation | `pr_ready` |
| `implementor` | `revision` | `changes_requested` | Address reviewer feedback | `pr_ready` |
| `implementor` | `revision` | `info_provided` | Resume implementation with user answers | `pr_ready` |
| `implementor` | `revision` | `conflicts_detected` | Resolve merge conflicts | `pr_ready` |
| `investigator` | `new` | — | Debug a bug report | `investigation_complete` |
| `investigator` | `revision` | `info_provided` | Resume investigation with user answers | `investigation_complete` |
| `reviewer` | `new` | — | PR code review | `approved` or `changes_requested` |

## Execution Lifecycle

**File:** `src/core/services/agent-service.ts`

`AgentService.execute(taskId, mode, agentType, revisionReason?, onOutput?)` performs 8 steps:

### Step 1: Fetch Task + Project

Loads the task and its project. Throws if the task, project, or project path is missing.

### Step 2: Create Agent Run Record

```typescript
const run = await this.agentRunStore.createRun({ taskId, agentType, mode });
```

Creates a database record with initial status `'running'`.

### Step 3: Manage Phase

Links or creates a task phase for the current mode, marks it as active.

### Step 4: Prepare Worktree

Reuses an existing worktree or creates a new one:

```
Branch naming: task/{taskId}/{agentType}
Multi-phase:   task/{taskId}/{agentType}/phase-{n}
Worktree path: {projectPath}/.agent-worktrees/{taskId}
```

Locks the worktree to prevent concurrent access.

### Step 5: Clean and Rebase

```typescript
await gitOps.clean();              // discard uncommitted changes
await gitOps.fetch('origin');
await gitOps.rebase('origin/main'); // isolate agent changes
```

Rebase failure is handled gracefully — aborted and logged as a warning.

### Step 6: Log Event

Records an `agent` event in the task event log.

### Step 7: Resolve and Execute Agent

AgentService gets the `Agent` from the framework and passes the engine via `AgentConfig`:

```typescript
const agent = this.agentFramework.getAgent(agentType);
const config: AgentConfig = { model, engine: agentDefEngine };
```

The `Agent` internally resolves the matching `IAgentLib` from its `AgentLibRegistry` using `config.engine`. The agent is tracked in the `runningAgents` map for stop support.

### Step 8: Return Run

Returns the `AgentRun` with `status: 'running'`. The caller can poll or listen for completion.

## Background Execution

`runAgentInBackground()` handles the actual agent work:

### Output Buffering

```typescript
const MAX_OUTPUT_BUFFER = 5 * 1024 * 1024; // 5 MB
```

Output is streamed to the caller via `onOutput` callback and accumulated in a buffer. The buffer is flushed to the database every 3 seconds. If the buffer exceeds 5 MB, it is truncated with `[output truncated]`.

### Agent Invocation

```typescript
const result = await agent.execute(context, config, wrappedOnOutput, onLog, onPromptBuilt);
```

### Validation Loop

For the `implementor` agent type (not planner/designer/investigator/reviewer), if the project has `config.validationCommands`:

1. Run each validation command in the worktree
2. If validation fails, re-run the agent with validation errors appended to the prompt
3. Repeat up to `maxValidationRetries` times (default 3)

### Outcome Transition

After agent completion, `tryOutcomeTransition()` finds a matching transition by `agentOutcome` and executes it (see [pipeline-engine.md](./pipeline-engine.md)).

For `pr_ready`, the service verifies the branch has actual changes via `git diff`. If no changes, overrides outcome to `no_changes`.

### Run Finalization

Updates the agent run record with: status, outcome, payload, exit code, output, cost tokens, completed timestamp. Unlocks the worktree. Updates the task phase status.

## Prompt Building

### Template Resolution vs Hardcoded Fallback

Prompt resolution follows a three-step priority chain inside `BaseAgentPromptBuilder.buildExecutionConfig()`:

1. **DB-backed template** — If `context.modeConfig?.promptTemplate` is set (loaded from `agent_definitions`), render it through `PromptRenderer.render()`.
2. **Resolved prompt** — If `context.resolvedPrompt` is populated (legacy path), use it directly.
3. **Hardcoded fallback** — Call `this.buildPrompt(context)` on the prompt builder subclass.

```typescript
// In base-agent-prompt-builder.ts — buildExecutionConfig()
if (context.modeConfig?.promptTemplate) {
  prompt = new PromptRenderer().render(context.modeConfig.promptTemplate, context);
} else {
  prompt = context.resolvedPrompt ?? this.buildPrompt(context);
}
```

After resolution, the builder appends skills (if any) and prepends task context entries (if any).

### PromptRenderer

**File:** `src/core/services/prompt-renderer.ts`

`PromptRenderer` handles all DB-backed template rendering. It performs simple string replacement of placeholder variables, then auto-appends a summary suffix and any validation errors.

**Template variables** (13 total):

| Variable | Description |
|----------|-------------|
| `{taskTitle}` | Task title |
| `{taskDescription}` | Task description (space-prefixed if present) |
| `{taskId}` | Task UUID |
| `{subtasksSection}` | Auto-generated subtask guidance (plan mode: asks for subtask output; implement mode: shows checklist) |
| `{planSection}` | Existing task plan as markdown |
| `{planCommentsSection}` | Admin feedback on the plan |
| `{priorReviewSection}` | Re-review notice when prior review context exists |
| `{relatedTaskSection}` | Related task info for bug reports (with CLI commands) |
| `{technicalDesignSection}` | Existing technical design as markdown |
| `{technicalDesignCommentsSection}` | Admin feedback on the design |
| `{defaultBranch}` | Project default branch (defaults to `main`) |
| `{skillsSection}` | Available skills list for Skill tool invocation |
| `{skipSummary}` | Replaced with empty string; when present in the template, suppresses the auto-appended summary suffix |

**Auto-appended behaviors:**
- Unless the template contains `{skipSummary}`, PromptRenderer appends: "When you are done, end your response with a '## Summary' section..."
- If `context.validationErrors` is set, validation error output is appended to the rendered prompt

### Task Context Prepending

If the task has prior context entries, they are prepended to the prompt:

```markdown
## Task Context

### [agent] plan_summary (2024-01-15T10:00:00Z)
Summary of previous plan...

### [reviewer] review_feedback (2024-01-15T11:00:00Z)
Review feedback...

---

{actual prompt}
```

### Validation Errors

If the agent is being retried after validation failure, errors are appended:

```
The previous attempt produced validation errors. Fix these issues, then stage and commit:

{validationErrors}
```

## Structured Output

JSON schemas returned per agent type via `getOutputFormat()`:

**planner:**
```json
{
  "plan": "Full implementation plan as markdown",
  "planSummary": "Short 2-3 sentence summary",
  "subtasks": ["Step 1", "Step 2"]
}
```

**designer:**
```json
{
  "technicalDesign": "Full technical design as markdown",
  "designSummary": "Short 2-3 sentence summary"
}
```

**investigator:**
```json
{
  "plan": "Detailed investigation report",
  "investigationSummary": "Short 2-3 sentence summary",
  "subtasks": ["Fix step 1", "Fix step 2"]
}
```

**implementor:**
```json
{
  "summary": "Short summary of changes"
}
```

## Context Accumulation

**Type:** `TaskContextEntry` in `src/shared/types.ts`

```typescript
interface TaskContextEntry {
  id: string;
  taskId: string;
  agentRunId: string | null;
  source: string;       // 'agent' | 'reviewer'
  entryType: string;    // see mapping below
  summary: string;      // up to 2000 chars
  data: Record<string, unknown>;
  createdAt: number;
}
```

After each successful agent run (exitCode === 0), a context entry is saved:

| Agent Type | Mode/Reason | Entry Type |
|-----------|-------------|------------|
| `planner` | `new` | `plan_summary` |
| `planner` | `revision` + `changes_requested` | `plan_revision_summary` |
| `designer` | any | `design_summary` |
| `investigator` | any | `investigation_summary` |
| `implementor` | `new` | `implementation_summary` |
| `implementor` | `revision` + `changes_requested` | `fix_summary` |
| `reviewer` | (approved) | `review_approved` |
| `reviewer` | (changes_requested) | `review_feedback` |

The summary is extracted from the agent's structured output (`planSummary`, `investigationSummary`, `designSummary`, or `summary` field). Context entries are loaded and prepended to subsequent agent prompts, giving each run knowledge of prior work.

## Orphan Recovery

On startup, `recoverOrphanedRuns()`:

1. Finds all agent runs with `status = 'running'`
2. Marks them as `failed` with outcome `interrupted`
3. Fails their active task phases
4. Unlocks their worktrees
5. Expires their pending prompts

This handles the case where the app was killed while agents were running.

## Session Management

Agent runs use Claude Code's native session resume feature to maintain conversational context across related runs. Each run stores its effective `sessionId` on the `agent_runs` record.

### Session Chaining

Sessions are identified by the run ID of the original creator (first `mode='new'` run):

```
implementor (new, run A)   → creates session A, stores sessionId=A
reviewer    (new, run B)   → resumes session A, stores sessionId=A
implementor (revision, C)  → resumes session A, stores sessionId=A
reviewer    (new, run D)   → resumes session A, stores sessionId=A
```

The reviewer shares the implementor's session for context continuity. Other agent types (planner, designer) maintain independent session chains.

### Session ID Resolution

`AgentService.execute()` determines `context.sessionId` based on agent type and mode:

| Agent Type | Mode | Session ID Source |
|-----------|------|-------------------|
| Any | `new` (first run) | `run.id` (creates new session) |
| `reviewer` | `new` | `findOriginalSessionRun('implementor').sessionId` (resumes implementor's session) |
| Any | `revision` | `findOriginalSessionRun(agentType).sessionId` (resumes own session chain) |
| Any | crash recovery | `pendingResumeRun.id` (resumes interrupted session) |

`findOriginalSessionRun()` returns the oldest completed `mode='new'` run for the given agent type. The stored `sessionId` field (not `run.id`) is used for chaining, because after crash recovery the completing run may have resumed an earlier session.

### Crash Recovery and Session IDs

When the app restarts after a crash:

1. `recoverOrphanedRuns()` marks interrupted runs as `failed` with outcome `interrupted`
2. `setPendingResume(taskId, interruptedRun)` stores the interrupted run for session resume
3. On next `execute()`, the new run resumes the interrupted session using `pendingResumeRun.id` as the session ID
4. The new run stores `sessionId = pendingResumeRun.id` (not its own `run.id`)

This ensures that downstream agents (e.g., reviewer) can find the correct session ID by reading the stored `sessionId` from the completing run, even when that run resumed an earlier session.

### Session Resume Fallback

**File:** `src/core/agents/agent.ts` — `isSessionResumeFailure()`

If a session resume fails — for any reason (missing session file, corrupt data, SDK bug) — `Agent.execute()` detects the failure and automatically retries with the full prompt and no session resume, rather than failing the run.

**Detection (`isSessionResumeFailure`):** After `lib.execute()` returns, the result is checked for all of:
- `exitCode !== 0` — process failed
- `killReason` is unset — not a timeout or user-initiated stop
- `costInputTokens` is 0 or undefined — no API calls were made
- `costOutputTokens` is 0 or undefined — no tokens consumed
- `output` is empty — no work was done

This pattern matches the specific case where Claude Code exits immediately because it cannot find or load the session to resume.

**Retry behavior:**
1. Logs a warning with the original error and session ID
2. Emits `[Session resume failed — retrying with full prompt]` to the output stream
3. Calls `lib.execute()` again with:
   - `prompt`: the full system prompt (`execConfig.prompt`), not the short continuation prompt
   - `resumeSession: false` — starts a fresh session instead of resuming
4. The retry result is used for outcome inference and result building as normal

The fallback fires at most once per `execute()` call. If the retry also fails, it fails normally through the standard error path.

## Agent Stop

`Agent` tracks active libs per runId and delegates stop to the correct lib:

```typescript
async stop(runId: string): Promise<void> {
  const iv = this.telemetryIntervals.get(runId);
  if (iv) clearInterval(iv);
  this.telemetryIntervals.delete(runId);
  this.lastTelemetries.delete(runId);
  const lib = this.activeLibs.get(runId);
  if (lib) {
    this.activeLibs.delete(runId);
    await lib.stop(runId);
  }
}
```

`ClaudeCodeLib` uses an `AbortController` per running agent:

```typescript
private runningStates = new Map<string, RunState>();

async stop(runId: string): Promise<void> {
  const state = this.runningStates.get(runId);
  if (!state) return;
  state.abortController.abort();
  this.runningStates.delete(runId);
}
```

`AgentService` tracks running `Agent` instances in a `runningAgents` map keyed by task ID, so it can route stop requests to the correct instance.

The abort controller is also triggered by the timeout timer. On abort, the SDK loop terminates with an `AbortError`, the agent returns with `exitCode = 1`.

## Edge Cases

- **`pr_ready` verification:** Before triggering the `pr_ready` outcome transition, agent service diffs the branch against `origin/main`. If empty, outcome is overridden to `no_changes`.
- **5 MB output cap:** Output buffer is hard-limited. Truncated output ends with `[output truncated]`.
- **ESM import:** The Claude SDK uses ESM. `ClaudeCodeLib` uses a dynamic `import()` to load the SDK at runtime.
- **Agent definition lookup failure:** If `getDefinitionByMode()` throws (definition missing or corrupt), the error is caught silently and the agent falls back to its hardcoded `buildPrompt()`.
- **AbortController keying:** The `runId` passed to `IAgentLib` is set to `context.task.id` (task ID) in `Agent.execute()`, not the `run.id` from the database. Concurrent runs on the same task are prevented by the `no_running_agent` guard.
- **Engine fallback:** If the agent definition has no engine set, `AgentService` defaults to `claude-code` engine.
- **CLI backend token counts:** The CLI backend (`cursor-agent`, `codex-cli`) always returns 0 for token counts because these engines do not expose usage telemetry.

## AgentSupervisor

**File:** `src/core/services/agent-supervisor.ts`

The `AgentSupervisor` is a background watchdog that periodically polls for agent runs that are stale or orphaned.

### Behavior

- **Poll interval:** 30 seconds (configurable via constructor)
- **Default timeout:** 35 minutes (fallback when a run has no stored `timeoutMs`)
- **Per-run timeout:** Uses `run.timeoutMs` from the database (populated by the telemetry flush every 3 seconds) plus a 5-minute grace period. This ensures the supervisor does not kill agents before their SDK-level timeout fires.

### Detection logic

On each poll, the supervisor iterates all active runs from the database:

1. **Timeout detection:** If a run has been active longer than its effective timeout (`run.timeoutMs + 5min grace`, or the default 35 minutes), the supervisor calls `agentService.stop()` to abort the agent, then marks the run `timed_out`.
2. **Stall detection:** Scans tasks in `agent_running` statuses with no running agent and no recently completed agent, then retries the `start_agent` hook (capped at 2 attempts per task).

Ghost runs (DB says running but no in-memory tracking) are prevented at the source: `AgentService.execute()` marks the DB run as `failed` if setup throws before the agent starts, and `recoverOrphanedRuns()` cleans up runs orphaned by daemon crashes at startup.

### Lifecycle

- `start()` — begins the poll interval (idempotent; no-op if already running)
- `stop()` — clears the poll interval

## SandboxGuard

**File:** `src/core/services/sandbox-guard.ts`

`SandboxGuard` enforces file-system boundaries for agent tool calls. It is used by `ClaudeCodeLib` as a `preToolUse` hook for both task agents and chat agents. `ChatAgentService` passes write-tool blocking via the `hooks.preToolUse` option on `AgentLibRunOptions`, which `ClaudeCodeLib` merges with the SandboxGuard hook.

### Configuration

Constructor takes two path lists:
- `allowedPaths` — directories where the agent can read and write
- `readOnlyPaths` — directories where the agent can read but not write

### Tool evaluation

`evaluateToolCall(toolName, toolInput)` returns `{ allow: boolean; reason?: string }`:

- **Write/Edit/MultiEdit/NotebookEdit** — path must be within `allowedPaths` and not match sensitive patterns
- **Read/Glob/Grep** — path must be within `allowedPaths` or `readOnlyPaths`
- **Bash** — extracts file paths from common commands (`cat`, `rm`, `cp`, `cd`, etc.) via regex and validates each against the path boundaries
- **Other tools** — allowed by default

### Sensitive path protection

Blocks access to paths matching: `/.ssh`, `/.aws`, `/.gnupg`, `/.config`, `/etc`, `.env`

### Fail-closed design

Any error during guard evaluation results in the tool call being blocked (not allowed). This prevents path-resolution edge cases from bypassing the sandbox.

## ChatAgentService

**File:** `src/core/services/chat-agent-service.ts`

`ChatAgentService` handles interactive chat sessions with AI agents, supporting both project-scoped and task-scoped conversations.

### Unified AgentLib Execution

All chat agent execution goes through the `IAgentLib` abstraction via `AgentLibRegistry`. The service resolves the lib by name, then calls `lib.execute()` with `AgentLibRunOptions` and `AgentLibCallbacks`. Feature detection via `lib.supportedFeatures()` adapts behavior per engine:

- **Hooks** — When the lib supports hooks, the service passes a `preToolUse` hook that hard-blocks write tools (Edit, Write, Bash write commands). The lib merges this with its own `SandboxGuard` hook.
- **Images** — When the lib supports images, base64 image data is passed via `options.images`. For non-image-supporting engines, image file paths are embedded in the prompt text instead.
- **Tool results** — The `onUserToolResult` callback streams tool result content back for real-time display.

### Agent Lib Resolution Order

The agent lib for a chat session is resolved in priority order:
1. `session.agentLib` — per-session override
2. `project.config.defaultAgentLib` — project-level default
3. Global setting `chat_default_agent_lib` — app-wide default
4. Hardcoded fallback: `claude-code`

If the resolved lib is not registered in the registry, falls back to `claude-code` with a warning.

### History Injection

Conversation history is loaded from `ChatMessageStore` and prepended to the prompt as a `## Conversation History` block. Assistant messages are extracted from their JSON storage format (structured `AgentChatMessage` arrays) back to plain text.

### Scope Resolution

`resolveScope()` determines the working directory and system prompt based on session scope:
- **Project scope** — uses the project path and a generic read-only assistant system prompt
- **Task scope** — resolves the task's project, builds a task-specific system prompt with task details, status, plan, and useful CLI commands

### Summarize Flow

`summarizeMessages()` compresses an entire conversation into a single system summary message:
1. Stops any running agent for the session
2. Builds a summarization prompt from all messages
3. Runs a single-turn Claude query to generate the summary
4. Replaces all messages with one system message containing the summary
5. Accumulates historical token costs onto the summary message

### Running Agent Tracking

Active chat agents are tracked in a `runningAgents` map keyed by session ID. Each entry stores: session info, scope, project, status, start time, last activity, and a message preview. Completed/failed agents are cleaned up after a 5-second delay. Stale entries (older than 1 hour) are cleaned up on `getRunningAgents()` calls.

### Agent-Chat AgentRun Tracking

Agent-chat sessions (source `'agent-chat'`) create persistent `AgentRun` records so that costs, messages, and execution history are visible in the Agent Runs tab alongside pipeline runs.

**Lifecycle:**
1. On the **first message** in an agent-chat session, `send()` creates a new `AgentRun` with `mode: 'revision'` and `agentType` matching the session's `agentRole` (e.g., `'planner'`). The run ID is stored on the session via `ChatSession.agentRunId`.
2. On **subsequent messages**, the existing `agentRunId` is reused — no new run is created.
3. In `runAgent()`'s `finally` block, the run is updated with accumulated `costInputTokens`, `costOutputTokens`, `messages`, and `status`.

**Relationship to pipeline runs:** Agent-chat revision runs are **separate** from the original pipeline run that produced the plan/design. This keeps cost attribution clean and avoids mutating a completed pipeline run.

```
Task
├── AgentRun (planner, mode='new')       ← original pipeline run that wrote the plan
├── AgentRun (planner, mode='revision')  ← all chat messages with the planner
├── AgentRun (designer, mode='new')      ← original pipeline run that wrote the design
└── AgentRun (designer, mode='revision') ← all chat messages with the designer
```

Both run types appear in `getRunsForTask(taskId)` and are visible in the Agent Runs tab.

**UI integration:** An `agent_run_info` message is emitted at the start of each `runAgent()` call when an `agentRunId` is available. The `ChatMessageList` component renders this as a small "Agent Run · View details →" link that navigates to `/agents/:runId`.
