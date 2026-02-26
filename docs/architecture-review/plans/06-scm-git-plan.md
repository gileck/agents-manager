# Plan 06: SCM/Git (8.5 → 9+)

## Gap Analysis

- **`scm-handler.ts` has zero test coverage** — Complex branching logic (rebase-fail, no-changes, PR-reuse) untested
- **`cleanup()` silent catch** — `local-worktree-manager.ts:145` bare `catch {}` hides worktree cleanup failures
- **Detached HEAD crash risk** — `parseWorktreeList()` doesn't guard against entries with no branch
- **CLI missing `initShellEnv()`** — PATH resolution not initialized, causing spawn failures
- **Multi-phase PR format undocumented** — `[Phase N/M]` title pattern not in docs
- **`isPRMergeable` logs to console.log instead of taskEventLog** — Progress polling goes to stdout, not the structured task event log

## Changes

### 1. Create `tests/unit/scm-handler.test.ts`

**File:** `tests/unit/scm-handler.test.ts` (new)

7+ test cases covering:
- Rebase failure triggers `rebaseAbort`
- No changes → push NOT called
- PR already exists → `createPR` NOT called
- Multi-phase PR title format
- `merge_pr` with no artifact
- `merge_pr` with not-mergeable PR
- `merge_pr` worktree-delete failure handling

### 2. Fix `cleanup()` silent catch

**File:** `src/main/services/local-worktree-manager.ts`

Replace bare `catch {}` at line ~145 with:
```ts
catch (err) { console.warn('Worktree cleanup failed:', err); }
```

### 3. Handle detached HEAD in `parseWorktreeList()`

**File:** `src/main/services/local-worktree-manager.ts`

Guard `worktrees.push(...)` with `if (taskId && branch)` so detached-HEAD worktree entries are excluded from the result.

### 4. Add `initShellEnv()` to CLI

**File:** `src/cli/index.ts`

Add fire-and-forget call at top before `program.parseAsync()`:
```ts
void initShellEnv();
```

### 5. Document multi-phase PR enrichment

**File:** `docs/git-scm-integration.md`

Add section documenting:
- `[Phase N/M]` title format for multi-phase PRs
- Subtask checklist body format

### 6. Route `isPRMergeable` progress to taskEventLog

**Files:** `src/main/services/github-scm-platform.ts`, `src/main/interfaces/scm-platform.ts`

The `isPRMergeable` polling loop currently logs progress via `console.log`. Inject `taskEventLog` (or an `onProgress` callback) so polling attempts are recorded in the structured task event log. This improves observability — operators can see merge-wait progress in the task timeline rather than only in stdout.

If injecting `taskEventLog` into the SCM platform is too coupling-heavy, accept an `onProgress?: (msg: string) => void` callback on the method signature and wire it from `scm-handler.ts`.

## Files to Modify

| File | Action |
|------|--------|
| `tests/unit/scm-handler.test.ts` | Create |
| `src/main/services/local-worktree-manager.ts` | Edit (2 changes) |
| `src/cli/index.ts` | Edit (add initShellEnv) |
| `docs/git-scm-integration.md` | Edit (add docs) |
| `src/main/services/github-scm-platform.ts` | Edit (add onProgress callback) |

## Complexity

Medium (~3 hours)
