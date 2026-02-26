# Architecture Review: SCM / Git Integration

**Date:** 2026-02-26 (re-review)
**Component:** SCM / Git Integration
**Previous Score: 7.4 / 10**
**Updated Score: 8.5 / 10**

## What Was Fixed

1. **`delete()` now tolerates "not found" errors** — Catches both `"is not a working tree"` and `"does not exist"`. Idempotency consistent across all state-changing operations.
2. **`shell-env.ts` async with eager initialization** — `initShellEnv()` uses `execFileAsync` (non-blocking). Called as first action in Electron `onReady`. `getUserShellPath()` retained as sync fallback for CLI.
3. **`cleanup()` narrowed with `activeTaskIds` parameter** — Worktrees for active tasks are preserved regardless of lock state.
4. **`asdf` implemented in fallback scanner** — `buildFallbackPath()` scans `~/.asdf/installs/nodejs/`.
5. **`isPRMergeable` logs progress during polling** — Per-attempt logging with PR number, attempt count, and state.
6. **47 unit tests added** — 17 for LocalWorktreeManager, 18 for LocalGitOps, 12 for GitHubScmPlatform.
7. **Docs updated** — All idempotency, cleanup, symlink, polling, asdf, and initShellEnv behaviors documented.

## Remaining Issues

1. **`scm-handler.ts` has zero unit tests** (Medium) — Four non-trivial paths untested: rebase-fail, no-changes, PR-reuse, PR-create.
2. **`cleanup()` silently swallows per-worktree removal errors** (Low) — No log on failed removal.
3. **`isPRMergeable` progress goes to `console.log`, not `taskEventLog`** (Low) — Architectural constraint.
4. **Detached HEAD worktrees produce empty `branch` field** (Low) — Parser produces `branch: ''`.
5. **CLI sync fallback risk** (Low) — `src/cli/index.ts` does not call `initShellEnv()`.

## Quality Ratings

| Dimension | Prev | Now | Notes |
|-----------|:----:|:---:|-------|
| Modularity | 9 | 9 | Three clean interfaces, production impls, matching stubs |
| Low Coupling | 9 | 9 | All interaction via interfaces |
| High Cohesion | 8 | 8 | Single-responsibility classes |
| Clear and Constrained State | 6 | 8 | `cleanup()` activeTaskIds guard, `delete()` idempotent |
| Deterministic Behavior | 6 | 7 | `cleanup()` narrowed, `delete()` idempotent |
| Explicit Dependency Structure | 9 | 9 | Constructor injection throughout |
| Observability | 8 | 8 | `isPRMergeable` logs progress to stdout |
| Robust Error Handling | 6 | 8 | `delete()` fixed, `cleanup()` narrowed |
| Simplicity of Structure | 8 | 8 | Small focused classes (100-191 lines) |
| Performance Predictability | 5 | 7 | `initShellEnv()` async eliminates 15s block |

| Category | Score |
|----------|:-----:|
| **Logic** | 9/10 — All operations correct, idempotent where expected |
| **Bugs** | 8/10 — All critical bugs fixed; `scm-handler.ts` untested paths remain |
| **Docs** | 8/10 — Accurate; multi-phase PR enrichment undocumented |
| **Code Quality** | 8/10 — Clean utility extraction in git-handlers |

**Overall: 8.5 / 10** (up from 7.4)
