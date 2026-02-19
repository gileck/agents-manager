# Agent System

Agent types, execution lifecycle, prompts, validation, and context accumulation.

## Agent Hierarchy

```
IAgent (interface)
  └── BaseClaudeAgent (abstract)
        ├── ClaudeCodeAgent    — plan, implement, review, request_changes, plan_revision, investigate
        └── PrReviewerAgent    — code review with verdict extraction
  └── ScriptedAgent            — test mock with pre-written scripts
```

**File locations:**
- `src/main/interfaces/agent.ts` — `IAgent` interface
- `src/main/agents/base-claude-agent.ts` — `BaseClaudeAgent`
- `src/main/agents/claude-code-agent.ts` — `ClaudeCodeAgent`
- `src/main/agents/pr-reviewer-agent.ts` — `PrReviewerAgent`
- `src/main/agents/scripted-agent.ts` — `ScriptedAgent`

### IAgent Interface

```typescript
export interface IAgent {
  readonly type: string;
  execute(
    context: AgentContext,
    config: AgentConfig,
    onOutput?: (chunk: string) => void,
    onLog?: (message: string, data?: Record<string, unknown>) => void,
    onPromptBuilt?: (prompt: string) => void
  ): Promise<AgentRunResult>;
  stop(runId: string): Promise<void>;
  isAvailable(): Promise<boolean>;
}
```

### BaseClaudeAgent

Abstract base class that handles SDK integration, abort control, prompt context assembly, and result construction.

Key abstract methods:
- `buildPrompt(context: AgentContext): string` — mode-specific prompt
- `inferOutcome(mode: string, exitCode: number, output: string): string` — outcome from exit code

Overridable methods:
- `getMaxTurns(context): number` — default 100
- `getOutputFormat(context): object | undefined` — JSON schema for structured output
- `getTimeout(context, config): number` — default 10 minutes

### ClaudeCodeAgent

`type: 'claude-code'`

| Mode | Max Turns | Timeout | Output Schema |
|------|-----------|---------|---------------|
| `plan` | 100 | 5 min | `{ plan, planSummary, subtasks }` |
| `plan_revision` | 100 | 5 min | `{ plan, planSummary, subtasks }` |
| `investigate` | 100 | 5 min | `{ plan, investigationSummary, subtasks }` |
| `implement` | 200 | 10 min | `{ summary }` |
| `request_changes` | 200 | 10 min | `{ summary }` |

### PrReviewerAgent

`type: 'pr-reviewer'`

- Max turns: 50
- Looks for `REVIEW_VERDICT: APPROVED` or `REVIEW_VERDICT: CHANGES_REQUESTED` in output
- Extracts numbered list items as review comments on `changes_requested`
- Returns payload `{ summary, comments }` for the `changes_requested` outcome

### ScriptedAgent

Test-only agent with a configurable script function. Built-in test scripts:
- `happyPlan` — returns `plan_complete`
- `happyImplement` — returns `pr_ready`
- `happyReview` — returns `approved`
- `failAfterSteps(n)` — fails after n calls
- `humanInTheLoop` — returns `needs_info`

## Agent Modes

```typescript
type AgentMode = 'plan' | 'implement' | 'review' | 'request_changes' | 'plan_revision' | 'investigate';
```

| Mode | Purpose | Default Outcome |
|------|---------|----------------|
| `plan` | Create implementation plan | `plan_complete` |
| `plan_revision` | Revise plan based on admin feedback | `plan_complete` |
| `investigate` | Debug a bug report | `investigation_complete` |
| `implement` | Code implementation | `pr_ready` |
| `request_changes` | Address reviewer feedback | `pr_ready` |
| `review` | PR code review | `approved` or `changes_requested` |

## Execution Lifecycle

**File:** `src/main/services/agent-service.ts`

`AgentService.execute(taskId, mode, agentType, onOutput?)` performs 8 steps:

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
Branch naming: task/{taskId}/{mode}
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

### Step 7: Fire-and-Forget Background Execution

Calls `runAgentInBackground()` and stores the promise in a `Map<string, Promise<void>>`. Returns immediately.

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

For `implement` and `request_changes` modes (not plan/investigate), if the project has `config.validationCommands`:

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

```typescript
// In agent-service.ts
try {
  const agentDef = await this.agentDefinitionStore.getDefinitionByMode(mode);
  if (agentDef?.modes.find(m => m.mode === mode)?.promptTemplate) {
    context.resolvedPrompt = this.resolvePromptTemplate(template, context);
  }
} catch {
  // Fall through to hardcoded buildPrompt
}

// In base-claude-agent.ts
let prompt = context.resolvedPrompt ?? this.buildPrompt(context);
```

The system first tries to load a prompt template from `agent_definitions`. If the lookup fails (no definition or no template), it falls back to the hardcoded `buildPrompt()` method on the agent class.

### Template Variables

`resolvePromptTemplate()` supports these placeholders:

- `{taskTitle}` — task title
- `{taskDescription}` — task description
- `{taskId}` — task UUID
- `{subtasksSection}` — auto-generated subtask guidance
- `{planSection}` — existing task plan
- `{planCommentsSection}` — admin feedback on plan
- `{priorReviewSection}` — re-review notice if applicable
- `{relatedTaskSection}` — related task info for bug reports

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

JSON schemas returned per mode via `getOutputFormat()`:

**plan / plan_revision:**
```json
{
  "plan": "Full implementation plan as markdown",
  "planSummary": "Short 2-3 sentence summary",
  "subtasks": ["Step 1", "Step 2"]
}
```

**investigate:**
```json
{
  "plan": "Detailed investigation report",
  "investigationSummary": "Short 2-3 sentence summary",
  "subtasks": ["Fix step 1", "Fix step 2"]
}
```

**implement / request_changes:**
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

| Agent Type | Mode | Entry Type |
|-----------|------|------------|
| `claude-code` | `plan` | `plan_summary` |
| `claude-code` | `plan_revision` | `plan_revision_summary` |
| `claude-code` | `investigate` | `investigation_summary` |
| `claude-code` | `implement` | `implementation_summary` |
| `claude-code` | `request_changes` | `fix_summary` |
| `pr-reviewer` | (approved) | `review_approved` |
| `pr-reviewer` | (changes_requested) | `review_feedback` |

The summary is extracted from the agent's structured output (`planSummary`, `investigationSummary`, or `summary` field). Context entries are loaded and prepended to subsequent agent prompts, giving each run knowledge of prior work.

## Orphan Recovery

On startup, `recoverOrphanedRuns()`:

1. Finds all agent runs with `status = 'running'`
2. Marks them as `failed` with outcome `interrupted`
3. Fails their active task phases
4. Unlocks their worktrees
5. Expires their pending prompts

This handles the case where the app was killed while agents were running.

## Agent Stop

`BaseClaudeAgent` uses an `AbortController` per running agent:

```typescript
private runningAbortControllers = new Map<string, AbortController>();

async stop(runId: string): Promise<void> {
  const controller = this.runningAbortControllers.get(runId);
  if (!controller) return;
  controller.abort();
  this.runningAbortControllers.delete(runId);
}
```

The abort controller is also triggered by the timeout timer. On abort, the SDK loop terminates with an `AbortError`, the agent returns with `exitCode = 1`.

## Edge Cases

- **`pr_ready` verification:** Before triggering the `pr_ready` outcome transition, agent service diffs the branch against `origin/main`. If empty, outcome is overridden to `no_changes`.
- **5 MB output cap:** Output buffer is hard-limited. Truncated output ends with `[output truncated]`.
- **ESM import:** The Claude SDK uses ESM. `BaseClaudeAgent` uses a dynamic `import()` to load the SDK at runtime.
- **Agent definition lookup failure:** If `getDefinitionByMode()` throws (definition missing or corrupt), the error is caught silently and the agent falls back to its hardcoded `buildPrompt()`.
- **AbortController keying:** Controllers are keyed by `context.task.id` (task ID), not by `run.id`. Stopping uses the task ID as the key.
