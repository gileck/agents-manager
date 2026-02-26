# Architecture Review: SCM / Git Integration

**Date:** 2026-02-26
**Component:** SCM / Git Integration
**Overall Score: 7.4 / 10**

## Files Reviewed

- `src/main/interfaces/worktree-manager.ts`, `git-ops.ts`, `scm-platform.ts`
- `src/main/services/local-worktree-manager.ts`, `local-git-ops.ts`, `github-scm-platform.ts`
- `src/main/services/shell-env.ts`
- `src/main/services/stub-worktree-manager.ts`, `stub-git-ops.ts`, `stub-scm-platform.ts`
- `src/main/handlers/scm-handler.ts`
- `src/main/services/agent-service.ts` (worktree lifecycle sections)
- `src/main/services/workflow-service.ts` (cleanupWorktree)
- `tests/e2e/error-scenarios.test.ts`, `artifact-collection.test.ts`, `ready-to-merge.test.ts`

---

## 1. Summary of Findings

The SCM/Git integration is a well-structured three-layer system: `IWorktreeManager` for worktree lifecycle, `IGitOps` for low-level git commands, and `IScmPlatform` for GitHub API operations. Stubs for all three enable fast in-memory testing. The `scm-handler.ts` cleanly wires these into pipeline hooks.

The system is generally well-designed. Four concrete issues found: a potential data-loss risk in `cleanup()`, undocumented multi-phase branch naming, `asdf` documented but not implemented in `shell-env.ts`, and zero test coverage on the real git layer.

---

## 2. Doc Sufficiency Assessment

### What the docs cover well
- High-level and low-level worktree management (creation, lock/unlock, deletion, cleanup)
- `.gitignore` handling and atomic open-or-create rationale
- All git operation methods with underlying git commands
- Two-phase rebase strategy
- PR lifecycle (happy path and changes-requested cycle)
- Shell environment resolution with fallback strategy

### What is missing or incorrect

| Gap | Severity |
|-----|----------|
| Multi-phase branch naming (`task/{taskId}/implement/phase-{n}`) completely missing | Medium |
| CLAUDE.md says "slug" but it's always a mode string | Low |
| `asdf` documented as shell-env fallback but NOT implemented | Medium |
| `isPRMergeable` 100-second polling loop undocumented | Low |
| `node_modules` symlink in worktree creation undocumented | Low |
| `cleanup()` deletes ALL unlocked worktrees (not just old ones) — only partially described | Low |

---

## 3. Implementation vs Docs Gaps

### Gap 1 — Multi-phase branch naming undocumented

**Doc says:** `task/{taskId}/{mode}`
**Code does:** Single-phase: `task/${taskId}/${mode}`, Multi-phase: `task/${taskId}/implement/phase-${phaseIdx + 1}`

### Gap 2 — `asdf` documented but not implemented

**Doc says:** `asdf: ~/.asdf/installs/nodejs/*/bin`
**Code:** No mention of asdf. Shell-env scans nvm, fnm, Homebrew, bun, volta, cargo — NOT asdf.

### Gap 3 — `isPRMergeable` polling undocumented

Code polls 10 attempts × 10 seconds = up to 100 seconds. Returns `false` on UNKNOWN after all retries. Not documented.

---

## 4. Bugs and Issues Found

### Issue 1 — `delete()` does not suppress "not found" errors (Medium)

**File:** `src/main/services/local-worktree-manager.ts`, line 117

`git worktree remove` fails if the worktree is already deleted. Unlike `lock()` and `unlock()` which tolerate idempotency errors, `delete()` propagates raw errors.

**Fix:** Catch and ignore "not a working tree" / "does not exist" errors.

### Issue 2 — `cleanup()` removes ALL unlocked worktrees, including active ones (Medium)

**File:** `src/main/services/local-worktree-manager.ts`, lines 120–133

Worktrees are only locked during active agent runs. Between runs (e.g., task in `implementing` awaiting user input), worktrees are unlocked. `cleanup()` will delete worktrees with valuable uncommitted work.

**Fix:** Cross-reference with task store before removing, or require explicit taskIds.

### Issue 3 — `isPRMergeable` blocks for up to 100 seconds (Medium)

**File:** `src/main/services/github-scm-platform.ts`, lines 52–68

The retry loop blocks inside a pipeline hook. Users perceive the system as hung. No progress feedback during polling.

### Issue 4 — `shell-env.ts` uses synchronous `execSync` (Low)

**File:** `src/main/services/shell-env.ts`, lines 29–34

`execSync` blocks the Node.js event loop for up to 5 seconds per shell (3 shells × 5s = 15s). In Electron this freezes the UI on first git operation. Cached after first call.

**Fix:** Use async `exec` with cache populated at app start.

### Issue 5 — `get()` has TOCTOU with `existsSync` (Low)

**File:** `src/main/services/local-worktree-manager.ts`, lines 85–91

`existsSync` check before `parseWorktreeList` — worktree could be deleted between calls. Harmless (returns `null` either way) but the fast path provides false confidence.

---

## 5. Test Coverage Assessment

### Tested (via stubs in e2e tests)
- Worktree create/lock/unlock/delete via `StubWorktreeManager`
- `push_and_create_pr` and `merge_pr` hooks via `StubScmPlatform`
- Worktree unlock-on-failure

### NOT tested
| Missing Test | Impact |
|---|---|
| `LocalWorktreeManager` — no unit tests (branch retry, `.gitignore` write, `parseWorktreeList` parsing) | HIGH |
| `LocalGitOps` — no unit tests (14+ methods untested in isolation) | HIGH |
| `GitHubScmPlatform` — no unit tests (`extractPRNumber`, `isPRMergeable` polling, `getPRStatus`) | HIGH |
| `scm-handler.ts` — no unit tests (rebase-failure path, no-changes guard, multi-phase PR generation) | MEDIUM |
| `cleanup()` behavior with active tasks | MEDIUM |

**The entire real-git layer is zero-coverage.** All validation runs against stubs.

---

## 6. Quality Ratings

| Dimension | Score | Rationale |
|-----------|:-----:|-----------|
| **Modularity** | 9 | Three clean interfaces each with production impl and test stub. `scm-handler.ts` wires via injected factories. |
| **Low Coupling** | 9 | All components interact only through interfaces. Factory functions injected, not concrete instances. |
| **High Cohesion** | 8 | Each class has a single responsibility. Minor deduction: `scm-handler.ts` mixes rebase, diff, push, and PR creation. |
| **Clear and Constrained State** | 6 | Lock/unlock managed by git (invisible to DB). `cleanup()` can silently delete in-progress work. `shell-env` cache is module-level global. |
| **Deterministic Behavior** | 6 | `isPRMergeable` has 100s heuristic. Pre-agent rebase failure is non-fatal but leaves worktree in unknown state. `cleanup()` depends on lock state at call time. |
| **Explicit Dependency Structure** | 9 | Deps injected via constructor. `ScmHandlerDeps` interface self-documents. External tools accessed through shell-env helper. |
| **Observability** | 8 | Every major git operation logged to `taskEventLog`. The `isPRMergeable` polling emits nothing during the 100s wait. |
| **Robust Error Handling** | 6 | Lock/unlock tolerate idempotency. Rebase failure aborts gracefully. `delete()` propagates "not found" errors. `cleanup()` can destroy work silently. |
| **Simplicity of Structure** | 8 | Each class is small (100–180 lines), single-responsibility. `scm-handler.ts` at 243 lines is the most complex but well-organized. |
| **Performance Predictability** | 5 | `shell-env.ts` can block event loop 15s. `isPRMergeable` holds hook open 100s. `parseWorktreeList` shells out on every call (no caching). |

**Overall: 7.4 / 10**

---

## 7. Action Items (Prioritized)

### Priority 1 — High Impact

- **P1-A:** Fix `delete()` to tolerate "not found" errors (match `lock()`/`unlock()` pattern)
- **P1-B:** Make `shell-env.ts` async or eagerly initialize on app start
- **P1-C:** Write unit tests for real git layer (`LocalWorktreeManager`, `LocalGitOps`, `GitHubScmPlatform`)

### Priority 2 — Medium Impact

- **P2-A:** Narrow `cleanup()` scope — cross-reference task store before deleting
- **P2-B:** Update docs for multi-phase branch naming
- **P2-C:** Remove `asdf` from docs or implement it in `shell-env.ts`
- **P2-D:** Add progress logging to `isPRMergeable` polling

### Priority 3 — Low Impact

- **P3-A:** Fix CLAUDE.md — change "slug" to "mode" in branch naming
- **P3-B:** Document `node_modules` symlink in worktree creation
- **P3-C:** Document `isPRMergeable` polling strategy (10 attempts × 10s, UNKNOWN fallback)
