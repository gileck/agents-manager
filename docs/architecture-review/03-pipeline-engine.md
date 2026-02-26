# Architecture Review: Pipeline Engine (State Machine)

**Date:** 2026-02-26
**Component:** Pipeline Engine
**Overall Score: 8.2 / 10**

## Files Reviewed

- `src/main/services/pipeline-engine.ts`
- `src/main/interfaces/pipeline-engine.ts`
- `src/main/stores/sqlite-pipeline-store.ts`
- `src/main/data/seeded-pipelines.ts`
- `src/main/handlers/core-guards.ts`
- `src/main/handlers/agent-handler.ts`, `scm-handler.ts`, `prompt-handler.ts`, `notification-handler.ts`, `phase-handler.ts`, `outcome-schemas.ts`
- `tests/e2e/pipeline-transitions.test.ts`, `pipeline-auto-transition.test.ts`, `guard-validation.test.ts`, `hook-execution.test.ts`, `max-retries-guard.test.ts`, `no-running-agent-guard.test.ts`, `admin-merge-guard.test.ts`

---

## 1. Summary of Findings

The pipeline engine is the most architecturally sound component in the codebase. It correctly implements a pluggable finite-state machine with well-separated concerns: the engine handles generic state transition logic, guards enforce preconditions, hooks execute domain side-effects. The transaction model is correct and the TOCTOU race condition is properly addressed. Hook execution policies (`required`, `best_effort`, `fire_and_forget`) add meaningful nuance that goes beyond what most simple state machines provide.

The primary weaknesses are in documentation completeness and one subtle behavioral inconsistency in `info_provided` outcome routing. The pipeline definitions have grown significantly beyond what the documentation describes, and four methods of the public interface (`getAllTransitions`, `executeForceTransition`, `checkGuards`, `retryHook`) are entirely absent from the docs.

---

## 2. Doc Sufficiency Assessment

**Score: 4/10**

### What the Docs Cover Well
- Core concepts (statuses, transitions, triggers, guards, hooks) — accurate and clear
- `executeTransition` step-by-step description — accurate for the happy path
- `TransitionContext` type — correct
- Four core guards (`has_pr`, `dependencies_resolved`, `max_retries`, `no_running_agent`) — accurate
- Five hook implementations (`start_agent`, `notify`, `create_prompt`, `merge_pr`, `push_and_create_pr`) — accurate
- `SIMPLE_PIPELINE` — correct
- Outcome-driven transition mechanism — accurate
- Human-in-the-loop flow — accurate
- Outcome schemas table — accurate
- Edge cases section — mostly accurate

### What is Missing or Incorrect

**Missing entirely:**

1. **`HookExecutionPolicy`** — The doc says "Hook failures are logged but do not roll back." This is only true for `best_effort` and `fire_and_forget`. The `required` policy does roll back the status change. The policy system (`required` | `best_effort` | `fire_and_forget`) and its implications are not documented anywhere.

2. **Four undocumented interface methods:**
   - `getAllTransitions(task)` — returns all transitions from the current status, grouped by trigger type
   - `executeForceTransition(task, toStatus, context?)` — bypasses guards, still runs hooks
   - `checkGuards(task, toStatus, trigger)` — runs guards without executing the transition (preview mode)
   - `retryHook(task, hookName, transition, context?)` — manually re-runs a single named hook

3. **Two undocumented guards:**
   - `has_pending_phases` — blocks `done → implementing` unless the task has pending phases
   - `is_admin` — checks `context.actor` against the `users` table; used on `ready_to_merge → done`

4. **One undocumented hook:**
   - `advance_phase` — marks the current phase as completed, activates the next pending phase, and fires a `system` trigger `done → implementing` transition

5. **AGENT_PIPELINE is substantially more complex than documented:**
   - The doc lists 7 statuses; the actual pipeline has 10: `open`, `designing`, `design_review`, `planning`, `plan_review`, `implementing`, `pr_review`, `ready_to_merge`, `needs_info`, `done`
   - The doc omits the entire `designing`/`design_review` phase (technical design flow)
   - `pr_review → done` (merge) in the doc is actually `ready_to_merge → done` in the implementation
   - The `conflicts_detected` agent outcome and its self-loop retry on `implementing` are undocumented
   - The `pr_ready` self-loop on `pr_review` (PR push retry) is undocumented
   - Phase cycling (`done → implementing`) via `system` trigger is undocumented
   - Recovery transitions (`planning → open`, `designing → open`, `implementing → plan_review`, etc.) are undocumented
   - `merge_pr` hook is marked `policy: 'required'` (if it fails the transition rolls back)

6. **BUG_AGENT_PIPELINE is substantially more complex than documented**

7. **`FEATURE_PIPELINE` transition table is incomplete** — the doc omits `in_progress → backlog`

8. **`BUG_PIPELINE` transition table is incomplete** — the doc omits `investigating → reported`

**Incorrect:**
- "Run hooks asynchronously (fire-and-forget). Hook failures are logged but do not roll back." — The current implementation has three policies. `required` hooks that fail DO cause a post-commit status rollback.

---

## 3. Implementation vs Docs Gaps

| Area | Doc Says | Implementation Does |
|------|----------|---------------------|
| Hook failure behavior | "fire-and-forget, failures logged only" | Three policies: `required` rolls back, `best_effort` logs warning, `fire_and_forget` logs error async |
| AGENT_PIPELINE statuses | 7 statuses | 10 statuses (adds `designing`, `design_review`, `ready_to_merge`) |
| AGENT_PIPELINE merge path | `pr_review → done` with `merge_pr` hook | `pr_review → ready_to_merge` → `ready_to_merge → done` with `is_admin` guard + `merge_pr` + `advance_phase` |
| Guards documented | 4 | 6 (adds `has_pending_phases`, `is_admin`) |
| Hooks documented | 5 | 6 (adds `advance_phase`) |
| IPipelineEngine methods | 2 (`getValidTransitions`, `executeTransition`) | 6 (adds `getAllTransitions`, `executeForceTransition`, `checkGuards`, `retryHook`) |
| `conflicts_detected` outcome | Not mentioned | Self-loop on `implementing`, guarded, retries with `resolve_conflicts` mode |
| `designing` phase | Not mentioned | Full phase with `technical_design` / `technical_design_revision` agent modes |
| Phase cycling | Not mentioned | `done → implementing` via `system` trigger + `advance_phase` hook |

---

## 4. Bugs and Issues Found

### Issue 1 — `info_provided` Outcome: Ambiguous Multi-Target Routing (Medium Severity)

**File:** `src/main/data/seeded-pipelines.ts` lines 156–162
**File:** `src/main/services/agent-service.ts` line 1168

The `needs_info` status has three simultaneous agent-trigger transitions, all with `agentOutcome: 'info_provided'`, going to `planning`, `implementing`, and `designing` respectively. `tryOutcomeTransition` calls `transitions.find(t => t.agentOutcome === outcome)`, which always picks the **first** match in array order — always `needs_info → planning`, regardless of whether the task was interrupted from `implementing` or `designing`.

The `respondToPrompt` method in `workflow-service.ts` correctly uses `resumeToStatus` stored in the prompt payload. But `tryOutcomeTransition` does not. If `info_provided` is ever reported as an agent outcome (as opposed to a prompt response), the routing will be silently wrong.

**Recommendation:** Either prevent `info_provided` from being a direct agent outcome, or require `resumeToStatus` in `context.data` when routing ambiguous outcomes.

### Issue 2 — `executeForceTransition` Does Not Check Status Consistency (Low-Medium Severity)

**File:** `src/main/services/pipeline-engine.ts` lines 361–386

`executeForceTransition` re-fetches the task inside the transaction but does **not** check whether `freshRow.status === task.status` before writing. Two concurrent force-transitions can both succeed silently.

**Recommendation:** Add the same consistency check as in `executeTransition`.

### Issue 3 — `required` Hook Rollback Uses Async Store, Not Raw SQL (Low Severity)

**File:** `src/main/services/pipeline-engine.ts` line 291

When a `required` hook fails, the rollback is performed via `await this.taskStore.updateTask(task.id, { status: task.status })` — **not** wrapped in a transaction. No compensating `transition_history` record is inserted.

**Recommendation:** Wrap the rollback in a transaction, log a compensating history entry, and handle rollback failure.

### Issue 4 — `checkGuards` Does Not Match `agentOutcome` (Low Severity)

**File:** `src/main/services/pipeline-engine.ts` lines 479–481

`checkGuards` does not filter by `agentOutcome`, making it unreliable for agent-triggered self-loop transitions sharing the same `from`/`to` pair.

**Recommendation:** Add an optional `outcome` parameter to `checkGuards`.

### Issue 5 — `start_agent` Hook Returns `{ success: true }` Before Agent Actually Starts (Informational)

The hook fires the agent with `.catch()` and immediately returns success. Not a current bug since all seeded pipelines use `fire_and_forget`, but misleading if ever registered with `policy: 'required'`.

### Issue 6 — `pr_ready` Self-Loop Shares `from/to` with `failed` Self-Loop (Informational)

Correctly handled by `tryOutcomeTransition` via `.find(t => t.agentOutcome === outcome)`. Worth documenting explicitly.

### Issue 7 — Transition History Not Inserted on Guard Failure (Informational)

Guard failures are only logged to `task_event_log`. No `transition_history` record for failed attempts.

---

## 5. Implementation Quality Ratings

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| **Modularity** | 9 | Guards and hooks are completely external to the engine; registered via `registerGuard`/`registerHook`. Each handler file is fully independent. The engine core has zero domain knowledge. |
| **Low Coupling** | 8 | Engine depends on 4 interfaces. Raw DB access in the transaction body is the only tight coupling point, justified for better-sqlite3 synchronous transactions. |
| **High Cohesion** | 9 | `PipelineEngine` does exactly one thing: orchestrate state transitions. Guards, hooks, and pipeline definitions are never mixed in. |
| **Clear and Constrained State** | 8 | All valid states are defined per-pipeline. Invalid transitions rejected at lookup time. TOCTOU correctly handled via transaction-internal re-fetch + status check. Force path intentionally relaxes constraints. |
| **Deterministic Behavior** | 7 | Happy-path transitions are deterministic. The `info_provided` multi-target ambiguity is a non-determinism risk. `fire_and_forget` hooks are inherently non-deterministic in timing (acceptable by design). |
| **Explicit Dependency Structure** | 9 | All dependencies are constructor-injected. Guards and hooks receive dependencies through closure, not hidden globals. |
| **Observability** | 9 | Every significant event logged to `task_event_log`: guard failures (with detail), hook failures by policy and name, status changes, force transitions, hook retries. `transition_history` provides SQL-queryable audit trail. |
| **Robust Error Handling** | 7 | Guards protected against unregistered names. Hook failures caught and classified by policy. Main gap: `required`-hook rollback is not itself transactional and has no compensating history entry. |
| **Simplicity of Structure** | 8 | 547 lines, clearly organized into 6 methods. `executeTransition` / `executeForceTransition` duplication (~80% shared logic) is the largest simplicity concern. |
| **Performance Characteristics** | 8 | Synchronous SQLite transaction for guards + status update is fast and bounded. Pipeline lookup on every transition is an N+1 pattern but acceptable for in-process SQLite with small pipelines. |

**Overall Average: 8.2 / 10**

---

## 6. Action Items (Prioritized)

### Priority 1 — Correctness

- **P1-A:** Fix `info_provided` ambiguous routing in `tryOutcomeTransition` — either prevent it as a direct agent outcome, or pass `resumeToStatus` through `context.data`
- **P1-B:** Add TOCTOU check to `executeForceTransition` — same `freshRow.status !== task.status` guard as in `executeTransition`

### Priority 2 — Reliability

- **P2-A:** Make required-hook rollback transactional — wrap in raw SQL transaction, insert compensating `transition_history` record, handle rollback failure
- **P2-B:** Add `outcome` parameter to `checkGuards` — correctly select among multiple agent-trigger transitions sharing the same `from/to` pair

### Priority 3 — Documentation

- **P3-A:** Update AGENT_PIPELINE section — add 3 missing statuses, full design phase, corrected merge path, all recovery transitions, phase cycling
- **P3-B:** Document hook execution policies (`required`/`best_effort`/`fire_and_forget`) and their implications
- **P3-C:** Document four missing IPipelineEngine methods
- **P3-D:** Document two missing guards (`has_pending_phases`, `is_admin`)
- **P3-E:** Document `advance_phase` hook
- **P3-F:** Fix BUG_PIPELINE and FEATURE_PIPELINE transition tables

### Priority 4 — Code Quality

- **P4-A:** Extract shared logic from `executeTransition` and `executeForceTransition` into helpers
- **P4-B:** Document `start_agent` hook's fire-and-forget nature
