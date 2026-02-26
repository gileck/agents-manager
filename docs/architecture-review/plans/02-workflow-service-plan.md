# WorkflowService Remediation Plan

**Source:** `docs/architecture-review/02-workflow-service.md` (score 6.8/10)
**Target score:** 9/10
**Priority order:** logic > docs > bugs > tests > code quality

---

## Phase 1: P0 -- Correctness

### Item 1: Fix dead code in `updateTask`

**File:** `src/main/services/workflow-service.ts`, lines 90-107
**Complexity:** Small

**Problem:** `Array.some()` and `Array.find()` use identical predicate. When `some()` returns false, `find()` always returns undefined. The `if (sameNameStatus)` branch is unreachable.

**Fix:** Remove the dead `find()` call. The `if (!statusExists)` block should directly fall back to first status:

```typescript
let newStatus = existingTask.status;
const statusExists = newPipeline.statuses.some((s) => s.name === existingTask.status);
if (!statusExists) {
  newStatus = newPipeline.statuses[0]?.name || 'open';
  await this.taskEventLog.log({ /* ... */ });
}
```

---

## Phase 2: P1 -- Documentation (Items 2-7)

### Item 2: Document `forceTransitionTask`
**File:** `docs/workflow-service.md` | **Complexity:** Small
- Add subsection explaining guard bypass, activity logging with `data.forced: true`
- Note: does NOT call `cleanupWorktree` on final states

### Item 3: Document `getPipelineDiagnostics`
**File:** `docs/workflow-service.md` | **Complexity:** Small
- Document all 5 diagnostic data areas: status metadata, all transitions, recent hook failures, agent state, stuck detection
- Note the 30s grace window heuristic and 24h event scan window

### Item 4: Document `retryHook`
**File:** `docs/workflow-service.md` | **Complexity:** Small
- Document two-pass search algorithm (exact match then fallback)
- Document retryable hook set: `merge_pr`, `push_and_create_pr`, `advance_phase`, `delete_worktree`

### Item 5: Document `advancePhase`
**File:** `docs/workflow-service.md` | **Complexity:** Small
- Document two code paths: explicit `advance_phase` hook transition vs fallback system transition

### Item 6: Update `AppServices` in architecture doc
**File:** `docs/architecture-overview.md` | **Complexity:** Small
- Add 9 missing members: `kanbanBoardStore`, `createGitOps`, `agentSupervisor`, `timelineService`, `workflowReviewSupervisor`, `chatMessageStore`, `chatSessionStore`, `chatAgentService`, `agentLibRegistry`
- Fix `notificationRouter` type to `MultiChannelNotificationRouter`

### Item 7: Document `resetTask(id, pipelineId?)` param
**File:** `docs/workflow-service.md` | **Complexity:** Small
- Add optional `pipelineId` parameter documentation

---

## Phase 3: P2 -- Architecture (Items 8-11)

### Item 8: Move `AGENT_SEND_MESSAGE` logic into WorkflowService

**Files:**
- `src/main/services/workflow-service.ts` — add `resumeAgent` method
- `src/main/interfaces/workflow-service.ts` — add to interface
- `src/main/ipc-handlers.ts` — simplify handler

**Complexity:** Medium

**Solution:** Add `resumeAgent(taskId, message, callbacks)` that:
1. Queues message first
2. Checks for running agent — if running, return null
3. Derives mode/agentType from last run
4. Calls `startAgent`

Simplify IPC handler to single `workflowService.resumeAgent()` call.

### Item 9: Fix `getDashboardStats` -- SQL aggregation

**Files:**
- `src/main/stores/sqlite-task-store.ts` — add `getStatusCounts()`
- `src/main/interfaces/task-store.ts` — add to interface
- `src/main/services/workflow-service.ts` — use SQL instead of in-memory loop

**Complexity:** Medium

**Solution:** Add `SELECT status, COUNT(*) GROUP BY status` method. Use `Promise.all` to parallelize queries.

### Item 10: Make optional deps required with no-op defaults

**Files:**
- `src/main/services/workflow-service.ts` — change constructor
- Create `NoopTaskContextStore`
- `tests/helpers/test-context.ts` — remove `undefined`

**Complexity:** Medium

Remove optional `?` from `createGitOps` and `taskContextStore` constructor params. Provide no-op implementations for testing.

### Item 11: Parallelize `getPipelineDiagnostics` queries

**File:** `src/main/services/workflow-service.ts`
**Complexity:** Small

Use `Promise.all` for independent queries after initial task/pipeline fetch.

---

## Phase 4: P3 -- Quick Wins

### Item 12: Standardize `mergePR` error handling
**Complexity:** Medium — Change return type to `TransitionResult`, replace throws with result objects.

### Item 13: Make `getDashboardStats` time-injectable
**Complexity:** Small — Add optional `now` parameter. Do alongside Item 9.

### Item 14: Document project CRUD exception
**Complexity:** Small — Note in docs that PROJECT_* handlers bypass WorkflowService by design.

### Item 15: Add log entry in `advancePhase` failure path
**Complexity:** Small — Add `taskEventLog.log()` before returning `{ success: false }`.

---

## Implementation Sequence

| Step | Items | Rationale |
|------|-------|-----------|
| 1 | Item 1 (dead code) | Correctness first. Isolated. |
| 2 | Item 10 (optional deps) | Constructor change — do early. |
| 3 | Items 9 + 13 (SQL + time-injectable) | Same method, do together. |
| 4 | Item 11 (parallelize diagnostics) | Independent, small. |
| 5 | Item 8 (resumeAgent) | New method + interface. |
| 6 | Item 15 (advancePhase logging) | Small, no interface changes. |
| 7 | Item 12 (mergePR errors) | Interface change. |
| 8 | Items 2-7, 14 (all docs) | Docs last, after code is final. |

---

## Expected Score Impact

| Dimension | Current | Expected | Key Changes |
|-----------|:-------:|:--------:|-------------|
| Modularity | 6 | 7 | resumeAgent extracted |
| Low Coupling | 7 | 8 | Optional deps eliminated |
| High Cohesion | 6 | 7 | Business logic out of IPC |
| Deterministic | 7 | 8 | Time-injectable stats |
| Explicit Deps | 8 | 9 | No more optional deps |
| Error Handling | 6 | 7.5 | mergePR standardized |
| Simplicity | 6 | 7 | Dead code removed |
| Performance | 6 | 8 | SQL aggregation, parallel queries |

**Projected overall: 8.5-9.0 / 10**
