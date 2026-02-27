# Plan 10: E2E Tests & Testkit Improvements (7.0 → 9+)

**Review:** `docs/architecture-review/10-e2e-tests-testkit.md`
**Target issues:** #1 (critical), #2-9 (high), #10-11, #14, #17

## 1. Add configurable failure modes to StubGitOps

**File:** `src/main/services/stub-git-ops.ts`

- Add `failures: Partial<Record<string, Error>>` map property
- Add `setFailure(method: string, error: Error)` and `clearFailures()` public methods
- Each method checks `this.failures[methodName]` and throws if set
- Add `diffOverride?: string` to allow returning empty diff (for no_changes testing)
- Default behavior unchanged — all methods succeed unless configured otherwise

Addresses: #5 (conflict resolution), #6 (no_changes), #10 (no configurable failure modes).

## 2. Add configurable failure modes to StubWorktreeManager

**File:** `src/main/services/stub-worktree-manager.ts`

- Add `createShouldFail: Error | null = null` property
- `create()` checks and throws if set
- Add `setCreateFailure(err: Error)` and `clearCreateFailure()` methods

Addresses: #11 (cannot simulate create failure).

## 3. Add configurable isPRMergeable + onProgress capture to StubScmPlatform

**File:** `src/main/services/stub-scm-platform.ts`

- Add `mergeableResult = true` property with `setMergeable(val: boolean)` setter
- Add `onProgressCalls: string[] = []` array
- `isPRMergeable()` returns `mergeableResult` and invokes `onProgress` callback if provided, recording calls in `onProgressCalls`

Addresses: #7 (onProgress ignored), #8 (always returns true).

## 4. Add e2e test for `recoverOrphanedRuns` (critical)

**File:** `tests/e2e/orphan-recovery.test.ts` (new, ~80 lines)

Test plan:
- Create a task at `implementing` via `ctx.createTaskAtStatus`
- Insert a `running` agent run directly via `ctx.agentRunStore.createRun`
- Create an active phase via `ctx.taskPhaseStore.createPhase`
- Lock the worktree via `ctx.worktreeManager.lock(taskId)`
- Call `ctx.agentService.recoverOrphanedRuns()`
- Assert: run status = `failed`, phase status = `failed`, worktree unlocked, event log entry exists

Addresses: #1 (critical — zero coverage for startup recovery).

## 5. Add e2e test for notification delivery

**File:** `tests/e2e/notification-delivery.test.ts` (new, ~60 lines)

Test plan:
- Create task at `implementing` status
- Execute a transition that has a `notify` hook (e.g. `implementing → pr_ready` via outcome)
- Assert `ctx.notificationRouter.sent.length >= 1`
- Assert notification payload includes correct taskId

Addresses: #2 (zero notification assertions).

## 6. Add e2e tests for BUG_AGENT_PIPELINE investigation workflow

**File:** `tests/e2e/bug-pipeline.test.ts` (new, ~120 lines)

Test plan using `BUG_AGENT_PIPELINE.id`:
- Test full path: `open → investigating → investigation_review → designing → design_review → implementing → pr_ready`
- Test `needs_info` from `investigating` status and resume
- Test `investigation_review` approval/revision flow
- Assert transition history and phase records at each step

Addresses: #3 (zero BUG_AGENT_PIPELINE coverage).

## 7. Add e2e tests for no_changes and conflicts_detected outcomes

**File:** `tests/e2e/agent-outcomes.test.ts` (new, ~100 lines)

Test plan:
- **no_changes**: Configure `StubGitOps.diffOverride = ''` (empty diff). Run outcome resolution flow. Assert task transitions to `open` via `no_changes`.
- **conflicts_detected**: Configure `StubGitOps.setFailure('rebase', new Error('conflict'))`. Assert task transitions back to `implementing` with `resolve_conflicts` mode.

Addresses: #5 (conflict resolution), #6 (no_changes).

## 8. Add missing factories

**File:** `tests/helpers/factories.ts`

Add:
- `createPendingPromptInput(taskId, runId, overrides?)` — returns `PendingPromptCreateInput`
- `createSubtaskInput(parentTaskId, projectId, pipelineId, overrides?)` — returns subtask input
- `createPhaseInput(taskId, overrides?)` — returns phase create input

Addresses: #17 (inline object literal duplication).

## 9. Fix double-registration in phase-cycling.test.ts

**File:** `tests/e2e/phase-cycling.test.ts`

Remove the duplicate `registerPhaseHandler` call — `test-context.ts:202` already registers it.

Addresses: #14 (double-registration).

## Files summary

| File | Action |
|------|--------|
| `src/main/services/stub-git-ops.ts` | Edit — add configurable failures |
| `src/main/services/stub-worktree-manager.ts` | Edit — add create failure mode |
| `src/main/services/stub-scm-platform.ts` | Edit — add mergeable config + onProgress capture |
| `tests/e2e/orphan-recovery.test.ts` | **Create** |
| `tests/e2e/notification-delivery.test.ts` | **Create** |
| `tests/e2e/bug-pipeline.test.ts` | **Create** |
| `tests/e2e/agent-outcomes.test.ts` | **Create** |
| `tests/helpers/factories.ts` | Edit — add 3 factories |
| `tests/e2e/phase-cycling.test.ts` | Edit — remove double registration |

## Verification

1. `yarn checks` — TypeScript + ESLint pass
2. `yarn test` — All existing + new tests pass
3. Expect ~15-20 new test cases across 4 new test files
