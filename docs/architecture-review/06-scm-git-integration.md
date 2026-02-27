# Architecture Review: SCM / Git Integration

**Date:** 2026-02-27 (Round 2 re-review)
**Component:** SCM / Git Integration
**Previous Score: 8.5 / 10**
**Updated Score: 9.2 / 10**

## Round 2 Changes Implemented

1. **`scm-handler.ts` now has 9 unit tests** — New file `tests/unit/scm-handler.test.ts` covers all critical paths: rebase-fail with abort, no-changes skips push, PR-reuse on same branch, multi-phase `[Phase N/M]` title format, missing branch in context, merge_pr with no artifact, merge_pr with non-mergeable PR, merge_pr worktree-delete failure (non-fatal), and merge_pr happy path. Tests use fully mocked dependencies injected via `ScmHandlerDeps`, exercising the real `registerScmHandler` function against a captured hook registry.

2. **`cleanup()` silent catch replaced with `console.warn`** — `local-worktree-manager.ts` line 146 now logs `console.warn('Worktree cleanup failed:', err)` instead of bare `catch {}`. Per-worktree removal errors are surfaced for debugging without interrupting the cleanup loop.

3. **Detached HEAD guard in `parseWorktreeList()`** — The `if (taskId && branch)` guard at line 184 ensures worktree entries without a branch (detached HEAD state) are excluded from results. Previously these would produce entries with `branch: ''`, which could confuse downstream callers.

4. **CLI calls `initShellEnv()`** — `src/cli/index.ts` now imports and calls `void initShellEnv()` before `program.parseAsync()`. This eagerly warms the shell PATH cache for the CLI, matching the Electron app's behavior and eliminating the synchronous fallback risk.

5. **`isPRMergeable` progress routed to `taskEventLog`** — The `IScmPlatform.isPRMergeable` signature gained an optional `onProgress?: (message: string) => void` callback parameter. `GitHubScmPlatform` routes polling progress through this callback (falling back to `console.log` when absent). In `scm-handler.ts`, the `merge_pr` hook wires `onProgress` to `taskEventLog.log()`, so merge-wait polling appears in the structured task event timeline rather than only in stdout.

6. **Multi-phase PR enrichment documented** — `docs/git-scm-integration.md` now includes a "Multi-Phase PR Enrichment" section documenting the `[Phase N/M]` title format, the subtask checklist body format, per-phase branch naming, and the PR-reuse/new-PR logic.

## Round 2 Remaining Issues

1. **No integration test for full push-create-merge cycle** (Low) — The 9 new scm-handler tests are unit tests with fully mocked dependencies. An integration test exercising a real git repo + worktree + PR lifecycle would catch environment-level issues (PATH resolution, gh CLI availability). This is low priority given the unit coverage is now solid.

2. **`parseWorktreeList()` does not handle malformed porcelain output** (Low) — If `git worktree list --porcelain` produces unexpected line formats (e.g., future git versions adding new fields), the parser silently ignores them. This is acceptable behavior but could be made more robust with a logged warning for unrecognized lines.

3. **`scm-handler.ts` error paths for `projectStore.getProject` not tested** (Low) — The `project?.path` null/missing guard exists in both hooks but is not covered by the new tests. The mock always returns a valid project. Adding a test for the "project has no path" error path would complete coverage.

## What Was Fixed (Round 1)

1. **`delete()` now tolerates "not found" errors** — Catches both `"is not a working tree"` and `"does not exist"`. Idempotency consistent across all state-changing operations.
2. **`shell-env.ts` async with eager initialization** — `initShellEnv()` uses `execFileAsync` (non-blocking). Called as first action in Electron `onReady`. `getUserShellPath()` retained as sync fallback for CLI.
3. **`cleanup()` narrowed with `activeTaskIds` parameter** — Worktrees for active tasks are preserved regardless of lock state.
4. **`asdf` implemented in fallback scanner** — `buildFallbackPath()` scans `~/.asdf/installs/nodejs/`.
5. **`isPRMergeable` logs progress during polling** — Per-attempt logging with PR number, attempt count, and state.
6. **47 unit tests added (Round 1)** — 17 for LocalWorktreeManager, 18 for LocalGitOps, 12 for GitHubScmPlatform.
7. **Docs updated** — All idempotency, cleanup, symlink, polling, asdf, and initShellEnv behaviors documented.

## Quality Ratings

| Dimension | R0 | R1 | R2 | Notes |
|-----------|:--:|:--:|:--:|-------|
| Modularity | 9 | 9 | 9 | Three clean interfaces, production impls, matching stubs |
| Low Coupling | 9 | 9 | 9 | All interaction via interfaces; `onProgress` callback avoids coupling SCM platform to event log |
| High Cohesion | 8 | 8 | 8 | Single-responsibility classes |
| Clear and Constrained State | 6 | 8 | 9 | Detached HEAD guard closes the last parser ambiguity |
| Deterministic Behavior | 6 | 7 | 8 | All identified edge cases now guarded and tested |
| Explicit Dependency Structure | 9 | 9 | 9 | Constructor injection throughout; `ScmHandlerDeps` interface for handler wiring |
| Observability | 8 | 8 | 9 | `isPRMergeable` progress now routes to structured task event log, not just stdout |
| Robust Error Handling | 6 | 8 | 9 | `cleanup()` logs failures; merge_pr worktree-delete failure is non-fatal and logged |
| Simplicity of Structure | 8 | 8 | 8 | Small focused classes (100-191 lines); handler ~245 lines |
| Performance Predictability | 5 | 7 | 8 | `initShellEnv()` async in both Electron and CLI; no sync fallback risk |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 — All operations correct, idempotent where expected, edge cases guarded |
| **Bugs** | 9/10 — All critical and medium bugs fixed; remaining items are low-severity gaps |
| **Docs** | 10/10 — Multi-phase PR enrichment, onProgress callback, all behaviors documented |
| **Code Quality** | 9/10 — Clean utility extraction, comprehensive test coverage (56 total tests across 4 files) |
| **Test Coverage** | 9/10 — 56 tests: 17 worktree + 20 git-ops + 12 scm-platform + 9 scm-handler (up from 47) |

**Overall: 9.2 / 10** (up from 8.5)

### Score Justification

The Round 2 changes closed all five remaining issues from the Round 1 review:

- The scm-handler, previously at zero test coverage, now has 9 focused unit tests covering rebase failure, no-changes, PR reuse, multi-phase title formatting, merge guards, and non-fatal worktree cleanup. Total SCM test count rises from 47 to 56.
- The silent `catch {}` in `cleanup()` was replaced with a `console.warn`, restoring visibility into per-worktree removal failures.
- The detached HEAD parser gap was closed with a `taskId && branch` guard, preventing empty-branch entries from reaching callers.
- The CLI now eagerly calls `initShellEnv()`, matching the Electron app's PATH resolution strategy and eliminating the synchronous fallback risk for CLI users.
- The `isPRMergeable` progress callback was promoted from `console.log` to a structured `onProgress` parameter, wired through to `taskEventLog` in the scm-handler. This keeps the SCM platform decoupled (callback injection, not direct dependency) while routing operational visibility into the task event timeline.

The remaining issues are all low-severity: no integration test for the full cycle, no test for the project-not-found guard, and the parser's silent handling of unrecognized porcelain lines. None represent correctness risks.
