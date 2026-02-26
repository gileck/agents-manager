# Pipeline Engine Improvement Plan

**Source:** `docs/architecture-review/03-pipeline-engine.md` (score 8.2/10)
**Target score:** 9/10
**Priority order:** logic > docs > bugs > tests > code quality

---

## Overview

13 action items across four priority tiers. P1 (Correctness) and P2 (Reliability) require code changes. P3 (Documentation) requires updates to `docs/pipeline-engine.md`. P4 (Code Quality) is a quick win.

### Dependency Graph

```
P1-A (info_provided fix) ── standalone
P1-B (TOCTOU in force transition) ── standalone
P2-A (rollback transactional) ── standalone
P2-B (checkGuards outcome param) ── standalone
P4-A (extract shared logic) ── depends on P1-B, P2-A being complete
P3-A through P3-F ── documentation, all standalone, best done after code changes
```

---

## P1-A: Fix `info_provided` Ambiguous Routing

**Complexity:** Small
**Files:** `src/main/services/agent-service.ts` (lines 1156-1202)

**Problem:** `tryOutcomeTransition` uses `.find()` which always picks the first match. For `needs_info` status with `info_provided` outcome, there are 3 matching transitions (to `planning`, `implementing`, `designing`). Always picks `planning` regardless of origin.

**Fix:** Make `tryOutcomeTransition` context-aware:
```typescript
const candidates = transitions.filter((t) => t.agentOutcome === outcome);
const resumeTo = data?.resumeToStatus as string | undefined;
const match = (resumeTo
  ? candidates.find((t) => t.to === resumeTo)
  : undefined)
  ?? candidates[0];
```

Add warning log when multiple candidates exist but no `resumeToStatus` is provided.

**Test:** Create pipeline with 3 `info_provided` transitions, verify `resumeToStatus` selects correct target.

---

## P1-B: Add TOCTOU Check to `executeForceTransition`

**Complexity:** Small
**Files:** `src/main/services/pipeline-engine.ts` (lines 361-386)

**Problem:** `executeForceTransition` re-fetches task but doesn't verify status hasn't changed. Two concurrent force-transitions can both succeed.

**Fix:** After line 365, add:
```typescript
if (freshRow.status !== task.status) {
  throw new Error(`Task status changed: expected "${task.status}", got "${freshRow.status}"`);
}
```

**Test:** Execute force transition, then attempt another with stale task object — assert failure.

---

## P2-A: Make Required-Hook Rollback Transactional

**Complexity:** Medium
**Files:** `src/main/services/pipeline-engine.ts` (lines 288-303)

**Problem:** Rollback uses async `taskStore.updateTask()` — not in a transaction. No compensating `transition_history` record. No rollback failure handling.

**Fix:** Replace with raw SQL transaction:
1. Update task status back to original
2. Insert compensating `transition_history` record with `_rollback: true`
3. Wrap both in synchronous `db.transaction()`
4. Catch rollback failures and log as critical errors

**Test:** Enhance existing hook-execution test to verify compensating history record.

---

## P2-B: Add `outcome` Parameter to `checkGuards`

**Complexity:** Small
**Files:**
- `src/main/interfaces/pipeline-engine.ts` (line 8)
- `src/main/services/pipeline-engine.ts` (lines 474-501)

**Problem:** `checkGuards` doesn't filter by `agentOutcome`, making it unreliable for self-loop transitions.

**Fix:** Add optional `outcome` parameter:
```typescript
async checkGuards(task, toStatus, trigger, outcome?) {
  const transition = pipeline.transitions.find(
    (t) => fromMatch(t) && t.to === toStatus && t.trigger === trigger
      && (!outcome || t.agentOutcome === outcome),
  );
  // ...
}
```

**Test:** Pipeline with two self-loops, different outcomes — verify correct guards evaluated.

---

## P3-A: Update AGENT_PIPELINE Documentation

**Complexity:** Medium
**Files:** `docs/pipeline-engine.md`

**Changes:**
1. Update status list from 7 to 10 (add `designing`, `design_review`, `ready_to_merge`)
2. Add full design phase transitions
3. Correct merge path: `pr_review → ready_to_merge → done`
4. Add all recovery transitions
5. Add phase cycling (`done → implementing` via system trigger)
6. Add missing agent outcomes (`conflicts_detected`, `pr_ready` self-loop)
7. Document self-loop disambiguation

---

## P3-B: Document Hook Execution Policies

**Complexity:** Small
**Files:** `docs/pipeline-engine.md`

Add "Hook Execution Policies" section:
- `required` — awaited, rollback on failure
- `best_effort` — awaited, logged but no rollback
- `fire_and_forget` — not awaited, async error logging

Correct existing incorrect statement about all hooks being fire-and-forget.

---

## P3-C: Document Four Missing IPipelineEngine Methods

**Complexity:** Small
**Files:** `docs/pipeline-engine.md`

Document: `getAllTransitions`, `executeForceTransition`, `checkGuards`, `retryHook`.

---

## P3-D: Document Two Missing Guards

**Complexity:** Small
**Files:** `docs/pipeline-engine.md`

Add to guards table: `has_pending_phases`, `is_admin`.

---

## P3-E: Document `advance_phase` Hook

**Complexity:** Small
**Files:** `docs/pipeline-engine.md`

Document: marks current phase completed, activates next pending phase, triggers system `done → implementing`.

---

## P3-F: Fix BUG_PIPELINE and FEATURE_PIPELINE Tables

**Complexity:** Small
**Files:** `docs/pipeline-engine.md`

- FEATURE_PIPELINE: Add `in_progress → backlog`
- BUG_PIPELINE: Add `investigating → reported`
- BUG_AGENT_PIPELINE: Add full status list

---

## P4-A: Extract Shared Logic (Quick Win)

**Complexity:** Small-Medium
**Files:** `src/main/services/pipeline-engine.ts`

Extract shared logic from `executeTransition`/`executeForceTransition` into private helpers (`executeHooks`, `buildTransaction`). Do after P1-B and P2-A.

---

## Implementation Sequence

| Step | Item | Complexity | Est. Lines Changed |
|------|------|-----------|-------------------|
| 1 | P1-B: TOCTOU check | Small | ~3 lines |
| 2 | P1-A: info_provided routing | Small | ~15 lines |
| 3 | P2-A: Transactional rollback | Medium | ~25 lines |
| 4 | P2-B: checkGuards outcome | Small | ~5 lines |
| 5 | P4-A: Extract shared logic | Small-Medium | ~80 lines refactored |
| 6 | P3-A through P3-F: All docs | Medium | ~190 lines in docs |

### Suggested Commits

1. "fix: Resolve info_provided ambiguous routing and add TOCTOU check to force transitions"
2. "fix: Make required-hook rollback transactional and add outcome param to checkGuards"
3. "refactor: Extract shared transition logic into private helpers"
4. "docs: Complete pipeline engine documentation"

---

## Expected Score Impact

**Projected overall: 9.0+ / 10** — Pipeline engine is already strong (8.2); these fixes close the remaining correctness and documentation gaps.
