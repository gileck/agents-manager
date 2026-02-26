# Implementation Plan: SCM/Git Integration Fixes

**Review:** `docs/architecture-review/06-scm-git-integration.md`
**Current Score:** 7.4 / 10
**Target Score:** ~9 / 10
**Priority Order:** logic > docs > bugs > tests > code quality

---

## Phase 1: Bug Fixes (parallel)

### P1-A: Fix `delete()` to tolerate "not found" errors
**File:** `src/main/services/local-worktree-manager.ts` (line 116-118)
**Complexity:** Small

Wrap in try/catch suppressing "is not a working tree" / "does not exist" errors, matching `lock()`/`unlock()` pattern.

### P1-B: Make `shell-env.ts` async with eager init
**Files:** `src/main/services/shell-env.ts`, `src/main/index.ts`
**Complexity:** Medium

Add `initShellEnv()` async function using `execFile` (not `execSync`). Call in `onReady` before `createAppServices`. Existing sync `getUserShellPath()` becomes a fast cache hit.

### P2-A: Narrow `cleanup()` scope
**Files:** `src/main/interfaces/worktree-manager.ts`, `src/main/services/local-worktree-manager.ts`, stub
**Complexity:** Medium

Add optional `activeTaskIds?: string[]` parameter. Skip worktrees whose taskId is in the active set. Backward compatible.

### P2-C: Add asdf to `shell-env.ts`
**File:** `src/main/services/shell-env.ts`
**Complexity:** Small

Add asdf scanning block (`~/.asdf/installs/nodejs/*/bin`) following nvm pattern.

### P2-D: Add progress logging to `isPRMergeable`
**File:** `src/main/services/github-scm-platform.ts`
**Complexity:** Small

Add `console.log` during polling retries with attempt count.

---

## Phase 2: Tests (depends on Phase 1)

### P1-C: Write unit tests for real git layer
**Files:** New `tests/unit/local-worktree-manager.test.ts`, `local-git-ops.test.ts`, `github-scm-platform.test.ts`
**Complexity:** Large

Mock `execFile` to test argument assembly, output parsing, error handling. Test cases:
- Worktree: create, get, list, lock/unlock idempotency, delete idempotency, cleanup with activeTaskIds
- GitOps: commit, push, log parsing, diff, rebase
- SCM: extractPRNumber, createPR, mergePR, isPRMergeable (mock timers), getPRStatus

---

## Phase 3: Documentation (depends on Phase 1)

### P2-B: Update multi-phase branch naming
**File:** `docs/git-scm-integration.md`
**Complexity:** Small

Document: `task/{taskId}/implement/phase-{n}` for multi-phase tasks.

### P3-A: Fix "slug" → "mode" in frontmatter
**File:** `docs/git-scm-integration.md` | Run `yarn build:claude` after.

### P3-B: Document `node_modules` symlink
**File:** `docs/git-scm-integration.md`

### P3-C: Document `isPRMergeable` polling strategy
**File:** `docs/git-scm-integration.md`

---

## Score Impact Estimate

| Dimension | Current | After | Delta |
|-----------|:-------:|:-----:|:-----:|
| Clear and Constrained State | 6 | 8 | +2 |
| Deterministic Behavior | 6 | 7.5 | +1.5 |
| Robust Error Handling | 6 | 8.5 | +2.5 |
| Performance Predictability | 5 | 7 | +2 |

**Estimated new overall: ~8.7-9.0 / 10**
