# Error Handling & Recovery

How the pipeline handles agent failures, auto-retries, stuck task detection, and concurrent agent runs.

See also: [engine.md](engine.md) | [json-contract.md](json-contract.md) | [outcome-schemas.md](outcome-schemas.md) | [event-log.md](event-log.md) | [ui.md](ui.md)

---

## Failed Agent Handling

When an agent crashes, times out, or exits with an error mid-pipeline, the system needs a clear recovery path.

### What Happens

1. `AgentService.onAgentCompleted()` detects `exitCode !== 0` or a timeout
2. Pipeline transitions to `failed` status with the error captured in `TransitionContext.reason`
3. Event log records the failure with full error details (`agent.failed` event)
4. Notification sent to admin ("Agent failed on task X: timeout after 10m")
5. Partial changes stay on the agent's branch — the branch is the agent's scratch space

### Auto-Retry

Before transitioning to `failed`, the system checks **auto-retry settings**. If retries remain, the agent is restarted automatically with failure context injected into the prompt.

```typescript
interface AgentRetryConfig {
  enabled: boolean;              // default: true
  maxRetries: number;            // default: 3
  delayBetweenRetries: number;   // ms, default: 30000 (30s)
  backoffMultiplier: number;     // default: 2 (30s → 60s → 120s)
  timeoutPerAttempt: number;     // ms, default: 600000 (10 min)
  retryOn: AgentFailureType[];   // which failures to retry on
}

type AgentFailureType = 'timeout' | 'crash' | 'rate_limit' | 'all';
```

**Settings UI (per-project or global):**
```
Agent Auto-Retry
├── Enabled:              [✓]
├── Max retries:          [3]
├── Initial delay:        [30] seconds
├── Backoff multiplier:   [2x]  (30s → 60s → 120s)
├── Timeout per attempt:  [10] minutes
└── Retry on:             [✓] Timeout  [✓] Crash  [✓] Rate limit
```

**Flow:**
1. Agent fails (crash, timeout, rate limit)
2. System checks retry config: `currentAttempt < maxRetries`?
3. If yes → log retry event, wait delay, restart agent with failure context
4. If no → transition to `failed` for manual intervention
5. Each retry is a separate `agent_run` record linked to the same task

**Retry prompt injection:**
```
This is retry attempt #2 of 3.
Previous attempt failed: timeout after 10m
Last agent action: Writing src/middleware/auth.ts

Resume from where the previous attempt left off.
```

**Event log entries:**
- `agent.retry_scheduled` — "Auto-retry #2 scheduled in 60s"
- `agent.retry_started` — "Auto-retry #2 started"
- `agent.retries_exhausted` — "All 3 retries exhausted, transitioning to failed"

### Admin Recovery Options

From the `failed` status (after retries exhausted), the admin can:

| Action | Transition | What Happens |
|--------|-----------|--------------|
| **Retry** | failed → in_progress | Restarts the agent with full context (including what failed and why) |
| **Retry from planning** | failed → open | Goes back to the beginning |
| **Cancel** | failed → cancelled | Gives up on this task |

The retry prompt includes failure context:
```
Previous attempt failed: timeout after 10m
Last agent action: Writing src/middleware/auth.ts
Error: Process exited with code 1

Resume implementation, addressing the previous failure.
```

### Stuck Task Detection

The **TaskSupervisor** (background health loop, see `architecture.md`) handles stuck detection on a configurable interval:
- Agent process dead (PID gone) → mark failed, trigger auto-retry
- Agent running > configured timeout → kill process, trigger auto-retry
- Task in `waiting` status > 24h → send reminder notification to all channels
- Task in `active` status with no running agent > 10min → send warning notification
- Orphaned retry (app restarted mid-delay) → re-execute now

All supervisor actions are logged to the task event log for traceability.

---

## Concurrent Agent Runs

### Current Rule: One Agent Per Task

Enforced by the `no_running_agent` guard. This keeps things simple and prevents conflicts (two agents editing the same files).

### Future: Multiple PRs Per Large Task

The data model already supports multiple agent runs per task. To enable parallel work on large tasks in the future:

1. **Remove or relax the guard** — allow multiple concurrent runs
2. **Branch per run** — each agent run gets its own branch (already supported via `branchStrategy`)
3. **Multiple PR artifacts** — task can have multiple `pull_request` artifacts
4. **Sub-task pattern** — alternatively, break large tasks into sub-tasks with dependencies (already supported)

The architectural decision: **start with 1 agent per task**, but nothing in the data model or interface design prevents relaxing this later. The constraint lives in a single guard function, not spread across the codebase.

### Same Project, Multiple Tasks

Multiple tasks in the same project can have agents running in parallel — this is fully supported from Phase 2. Each agent works on its own branch.

---

## Non-Critical Failure Handling

Not every failure should block the primary operation. The following decisions govern how the system handles failures in secondary/side-effect operations.

### Hook Failure During Transition (Decision 3a)

When a pipeline transition fires hooks (e.g., `start_agent`, `notify`), the status change is committed **before** hooks execute. If a hook throws:

- **Log the error** to the task event log (`hook.failed` event).
- **Continue executing remaining hooks** — each hook runs in its own try/catch.
- **Do NOT roll back** the status change. The transition is considered successful.
- Failed hooks are recorded in `transition_history.hooks_executed` for debugging.

Non-critical hooks should never block a transition. See [engine.md — Hook Execution Error Handling](engine.md#hook-execution-error-handling) for the code sketch.

### Artifact Collection Failure (Decision 3b)

Artifact collection (Step 8 in `agent-platform.md`) is **best-effort**. If any artifact collection step fails (e.g., git log parsing, PR creation, diff stat collection):

- **Log the failure** to the task event log.
- **Proceed** with the pipeline transition — the agent's outcome is still valid.
- The agent's work remains in the worktree and can be collected manually or re-tried.

The agent's code changes are safe on the branch regardless of whether artifacts were recorded in the database.

### Notification Channel Failure (Decision 3c)

When broadcasting to multiple notification channels (desktop, Telegram, Slack, etc.), the `NotificationRouter` uses `Promise.allSettled()`:

- **Send to all channels in parallel.**
- **Log individual channel failures** — but never block the operation.
- A failed Telegram send should not prevent the desktop notification from being delivered, and vice versa.

See [notification-system.md — Notification Router Implementation](../notification-system.md) for the `broadcast()` implementation.
