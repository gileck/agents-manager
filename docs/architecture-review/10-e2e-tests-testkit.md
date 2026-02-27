# Architecture Review: E2E Tests & Testkit

**Date:** 2026-02-27
**Component:** E2E Test Suite and Test Infrastructure
**Score: 7.0 / 10**

## Summary

The test infrastructure foundation is strong. `TestContext` mirrors production wiring with real SQLite stores, real `PipelineEngine`, real guards, and real hook handlers — only I/O boundaries (git, GitHub, notifications) are stubbed. Migration fidelity is excellent: `applyMigrations()` runs every production migration in order. The score is held back by coverage gaps in error paths, the BUG_AGENT_PIPELINE workflow being largely untested, and several stub limitations that prevent error-path testing.

## Strengths

- **TestContext fidelity** -- `tests/helpers/test-context.ts` wires real stores + engine + guards + hooks. Only I/O is stubbed.
- **Migration mirroring** -- `applyMigrations()` runs every production migration, preventing schema drift.
- **Full pipeline lifecycle** -- `phase-cycling.test.ts` exercises complete multi-phase cycle with real hook execution.
- **Hook policy coverage** -- `hook-execution.test.ts` covers `required`, `best_effort`, `fire_and_forget` with rollback assertions.
- **BFS path-finding** -- `createTaskAtStatus` uses BFS over manual transitions to navigate to any target status.
- **Cleanup discipline** -- Every e2e test has `afterEach(() => ctx.cleanup())` with in-memory SQLite. Zero state leakage.
- **Factory counter resets** -- `resetCounters()` called in `beforeEach` in all e2e files.

## Issues Found

### Critical

1. **No test for `recoverOrphanedRuns` (app shutdown recovery)** -- `AgentService.recoverOrphanedRuns()` marks orphaned `running` runs as `failed`, fails phases, unlocks worktrees, expires prompts. This critical startup reliability path has zero e2e coverage. If it regresses, `no_running_agent` guard would block all subsequent transitions.

### High

2. **Zero e2e tests assert notification delivery** -- `AGENT_PIPELINE` has 8+ transitions with `notify` hooks. `StubNotificationRouter` is wired in but no test ever checks `ctx.notificationRouter.sent`. The entire notification delivery path is untested at e2e level.

3. **No e2e tests for `BUG_AGENT_PIPELINE` investigation/design workflow** -- Investigation phase, investigation_review approval, design phase, and `needs_info` transitions in the bug pipeline have zero coverage.

4. **No e2e test for agent stop/cancellation mid-run** -- `AgentService.stop()` handles in-flight runs but is never tested. Could leave orphaned state.

5. **No e2e tests for conflict resolution outcome** -- `conflicts_detected` outcome loops back to `implementing` with `resolve_conflicts` mode. The loop guard (`max_retries`) is untested.

6. **No e2e tests for `no_changes` outcome** -- `implementing -> open` via `no_changes` is a meaningful business flow with zero coverage.

7. **`StubScmPlatform.isPRMergeable` ignores `onProgress` callback** -- Interface defines `onProgress?: (message: string) => void` but stub discards it. No test verifies progress messages are emitted during merge.

8. **No test for PR mergeability failure path** -- `StubScmPlatform.isPRMergeable` always returns `true`. The mergeability check branch in `scm-handler.ts` is completely untested.

9. **No test for `push_and_create_pr` hook failure (required policy rollback)** -- Only happy path tested.

### Medium

10. **`StubGitOps` has no configurable failure modes** -- Always succeeds. Production error handling for rebase failure, push failure, etc. can never be exercised through stubs.

11. **`StubWorktreeManager` cannot simulate `create()` failure** -- If worktree creation fails after run is created in store, phantom `running` run is left behind. Untested.

12. **`designing` phase has no e2e coverage** -- Tech-design phase with `design_ready`, `technical_design_revision` outcomes is untested.

13. **`needs_info` flow only tested from `planning` status** -- Pipeline also supports `needs_info` from `designing` and `implementing` with different `resumeToStatus` logic.

14. **`phase-cycling.test.ts` double-registers `registerPhaseHandler`** -- `test-context.ts` already registers it; test re-registers. If `registerHook` switched to appending, hooks would double-fire.

15. **`ready-to-merge.test.ts` bypasses pipeline engine with explicit status overrides** -- `createTaskInput(..., { status: 'pr_review' })` skips guards, hooks, and transition history.

16. **Factory counter is shared global state** -- Module-level globals in `factories.ts`. Latent fragility if Vitest runs files in parallel.

### Low

17. **No factories for `PendingPromptCreateInput`, `SubtaskInput`, or `ImplementationPhase`** -- Tests inline object literals, creating duplication.

18. **`createProjectInput` always uses `/tmp/test-project`** -- No factory variant for testing the no-path error path.

19. **`ScriptedAgent` ignores `_onLog`, `_onPromptBuilt`, `_onMessage` callbacks** -- Cannot test the contract that agents call these callbacks.

20. **`hook-execution.test.ts:192` uses `setTimeout(r, 50)` for fire-and-forget timing** -- Flaky under load.

21. **Migration tracking table created but migrations never marked as applied** -- Could diverge from production if future migrations check the tracking table.

## Quality Ratings

| Dimension | Score | Notes |
|-----------|:-----:|-------|
| Test Infrastructure (TestContext) | 8 | Excellent production fidelity, real migrations, BFS path-finder |
| E2E Business Flow Coverage | 6 | Core happy paths covered; major gaps in bug pipeline, designing, notifications, conflict resolution |
| Test Patterns & Conventions | 7 | Consistent cleanup, factory usage, good assertions; some status overrides bypass engine |
| Stub Quality | 6 | Faithfully implement interfaces but no configurable failure modes, callback gaps |
| Test Isolation | 8 | Per-test in-memory DB, afterEach cleanup everywhere; latent shared counter issue |
| Missing Scenario Coverage | 5 | Critical: shutdown recovery, conflict detection, no_changes, PR mergeability failure, agent cancellation |
| Assertion Quality | 7 | Deep secondary-effect assertions; some use `.toBeGreaterThanOrEqual(1)` where exact counts would be better |

| Category | Score |
|----------|:-----:|
| **Logic** | 7/10 -- Happy paths well-tested; error/edge paths largely absent |
| **Bugs** | 7/10 -- No known test bugs; gaps could mask production regressions |
| **Docs** | 6/10 -- No test documentation; patterns must be learned by reading existing tests |
| **Code Quality** | 8/10 -- Clean test structure, consistent patterns, good TestContext design |

**Overall: 7.0 / 10**
