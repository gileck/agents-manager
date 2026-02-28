---
title: Git & SCM Integration
description: Worktrees, git operations, PR lifecycle, and branch strategy
summary: LocalWorktreeManager manages git worktrees for isolated agent execution. PRs are created via gh CLI. Branch naming follows task/<id>/<agentType> convention.
priority: 3
key_points:
  - "Interface: IWorktreeManager in src/main/interfaces/worktree-manager.ts"
  - "Implementation: LocalWorktreeManager in src/main/services/local-worktree-manager.ts"
  - "Branch naming: task/<taskId>/<agentType>"
---
# Git & SCM Integration

Worktrees, git operations, PR lifecycle, and branch strategy.

## Worktree Management

**Interface:** `IWorktreeManager` in `src/main/interfaces/worktree-manager.ts`
**Implementation:** `LocalWorktreeManager` in `src/main/services/local-worktree-manager.ts`

```typescript
interface IWorktreeManager {
  create(branch: string, taskId: string): Promise<Worktree>;
  get(taskId: string): Promise<Worktree | null>;
  list(): Promise<Worktree[]>;
  lock(taskId: string): Promise<void>;
  unlock(taskId: string): Promise<void>;
  delete(taskId: string): Promise<void>;
  cleanup(activeTaskIds?: string[]): Promise<void>;
}

interface Worktree {
  path: string;
  branch: string;
  taskId: string;
  locked: boolean;
}
```

### Directory Convention

Worktrees live under `.agent-worktrees/` in the project root:

```
project-root/
├── .agent-worktrees/
│   ├── {taskId-1}/     ← worktree for task 1
│   └── {taskId-2}/     ← worktree for task 2
├── .gitignore           ← contains .agent-worktrees/ entry
└── src/
```

### .gitignore Handling

`LocalWorktreeManager` atomically ensures `.agent-worktrees/` is listed in `.gitignore` using `O_CREAT | O_RDWR` flags to avoid TOCTOU race conditions. This prevents accidental commits of agent worktrees.

### node_modules Symlink

When creating a worktree, `LocalWorktreeManager` symlinks `node_modules` from the main project into the worktree directory. This ensures native modules (e.g. better-sqlite3) resolve correctly inside the worktree without requiring a separate `yarn install`. The symlink uses `junction` mode and is non-fatal if it fails.

### Worktree Lifecycle

1. **Create** — `worktreeManager.create(branch, taskId)`
   - Fetches `origin` first (to base on `origin/main`, not local main)
   - Runs `git worktree add -b {branch} {path} origin/main`
   - If the branch already exists, retries without `-b` flag
   - Symlinks `node_modules` from the main project (see above)
   - Returns a `Worktree` object

2. **Lock** — `worktreeManager.lock(taskId)`
   - Called at the start of agent execution to prevent concurrent access
   - Idempotent: tolerates "already locked" errors

3. **Unlock** — `worktreeManager.unlock(taskId)`
   - Called after agent execution completes
   - Idempotent: tolerates "not locked" errors

4. **Delete** — `worktreeManager.delete(taskId)`
   - Runs `git worktree remove --force {path}`
   - Called on final status transitions, task reset, and task delete
   - Idempotent: tolerates "not a working tree" and "does not exist" errors

5. **Cleanup** — `worktreeManager.cleanup(activeTaskIds?)`
   - Prunes orphaned worktrees via `git worktree prune`
   - Removes unlocked worktrees that are not in the `activeTaskIds` set
   - When `activeTaskIds` is provided, worktrees belonging to those tasks are preserved even if unlocked
   - When omitted, all unlocked worktrees are removed (backward-compatible)

### Worktree Parsing

Uses `git worktree list --porcelain` output format. Extracts:
- Path from `worktree {path}` lines
- Branch from `branch refs/heads/{name}` lines
- Lock status from `locked` lines
- TaskId from the path segments: `.agent-worktrees/{taskId}`

## Git Operations

**Interface:** `IGitOps` in `src/main/interfaces/git-ops.ts`
**Implementation:** `LocalGitOps` in `src/main/services/local-git-ops.ts`

```typescript
export class LocalGitOps implements IGitOps {
  constructor(private cwd: string) {}
}
```

All operations shell out to `git` via `execFileAsync` with:
- `cwd` set to the working directory (project root or worktree path)
- `env` from `getShellEnv()` (resolved shell PATH)
- `timeout: 30_000` (30 seconds)
- `maxBuffer: 10 * 1024 * 1024` (10 MB)

### Key Methods

| Method | Git Command | Notes |
|--------|------------|-------|
| `fetch(remote?)` | `git fetch {remote}` | Default remote: `origin` |
| `createBranch(name, base?)` | `git checkout -b {name} {base}` | |
| `checkout(branch)` | `git checkout {branch}` | |
| `push(branch, force?)` | `git push -u origin {branch}` | Adds `--force-with-lease` if force=true |
| `pull(branch)` | `git pull origin {branch}` | |
| `diff(from, to?)` | `git diff {from}...{to}` | Three-dot syntax with toRef |
| `diffStat(from, to?)` | `git diff --stat {from}...{to}` | |
| `commit(message)` | `git add -A && git commit -m {message}` | Returns HEAD hash |
| `log(count?)` | `git log --format=%H%n%s%n%an%n%aI -n {count}` | Parsed into `GitLogEntry[]` |
| `rebase(onto)` | `git rebase {onto}` | |
| `rebaseAbort()` | `git rebase --abort` | |
| `getCurrentBranch()` | `git rev-parse --abbrev-ref HEAD` | |
| `clean()` | `git reset --hard HEAD && git clean -fd` | |
| `status()` | `git status --porcelain` | |
| `resetFile(path)` | `git checkout -- {path}` | |
| `showCommit(hash)` | `git show {hash}` | |
| `deleteRemoteBranch(branch)` | `git push origin --delete {branch}` | |

## Rebase Strategy

The system rebases the agent's work branch onto `origin/main` at two points:

### Before Agent Execution (in `agent-service.ts`)

```
git clean          ← discard uncommitted changes from prior runs
git fetch origin
git rebase origin/main   ← bring in latest changes from main
```

This ensures the agent works on top of the latest codebase.

### Before PR Creation (in `scm-handler.ts`, `push_and_create_pr` hook)

```
git fetch origin
git rebase origin/main   ← ensure PR diff only shows agent changes
git diff origin/main     ← collect diff for artifact
git push --force-with-lease  ← safe force-push after rebase
```

The rebase before push ensures the PR diff contains only the agent's changes, not unrelated commits on main.

**Rebase failure is non-fatal:** If rebase fails, it is aborted (`git rebase --abort`) and logged as a warning. The agent's work is preserved.

## SCM Platform

**Interface:** `IScmPlatform` in `src/main/interfaces/scm-platform.ts`
**Implementation:** `GitHubScmPlatform` in `src/main/services/github-scm-platform.ts`

```typescript
export class GitHubScmPlatform implements IScmPlatform {
  constructor(private repoPath: string) {}
}
```

Uses the `gh` CLI (GitHub CLI) via `execFileAsync` with 60-second timeout.

### PR Creation

```
gh pr create --title {title} --body {body} --head {head} --base {base}
```

- Title: task title
- Body: `"Automated PR for task {taskId}"`
- Head: agent branch name
- Base: `project.config.defaultBranch` or `'main'`

Returns `PRInfo` with `{ url, number }`.

### Multi-Phase PR Enrichment

For tasks with multiple implementation phases (`task.phases.length > 1`), the `push_and_create_pr` hook enriches the PR title and body:

**Title format:**
```
[Phase N/M] {task title}
```

Example: `[Phase 1/3] Add user authentication`

**Body format:**
```markdown
## {phase name}

Phase N of M for task {taskId}

### Subtasks
- [ ] Subtask 1
- [ ] Subtask 2
```

Each phase creates its own PR on a separate branch (`task/{taskId}/{agentType}/phase-{n}`). If a PR already exists for the same branch, a force-push updates it instead of creating a duplicate. If the existing PR is on a different branch (i.e. from a prior phase), a new PR is created for the current phase.

### PR Merge

```
gh pr merge {number} --squash --delete-branch
```

Uses squash merge strategy and deletes the remote branch after merge.

### PR Status

```
gh pr view {number} --json state
```

Returns `'merged' | 'closed' | 'open'`.

### isPRMergeable Polling

`isPRMergeable(prUrl)` polls GitHub to determine if a PR can be merged:

- **Mechanism:** Queries `gh pr view {number} --json mergeable`
- **Retry strategy:** Up to 10 attempts with 10-second delays (total: up to ~100 seconds)
- **Progress logging:** Each attempt logs the PR number, attempt count, and current mergeable state via an optional `onProgress` callback. When called from `scm-handler.ts`, progress is routed to the structured task event log (not stdout)
- **States:** `MERGEABLE` returns true, `CONFLICTING` returns false immediately, `UNKNOWN` triggers a retry
- **Fallback:** If still `UNKNOWN` after all 10 attempts, returns `false` (not mergeable)

This polling is necessary because GitHub computes merge status asynchronously after branch pushes.

## PR Lifecycle

### Happy Path

1. Agent completes implementation → outcome `pr_ready`
2. `push_and_create_pr` hook:
   - Rebases onto `origin/main`
   - Collects diff → saved as `diff` artifact
   - Pushes branch → `git push -u origin --force-with-lease`
   - Creates PR → saved as `pr` artifact
   - Updates task `prLink` and `branchName`
3. Auto-started PR reviewer agent
4. Reviewer reports `approved` → `merge_pr` hook:
   - Removes worktree (unlock + delete)
   - Merges PR via `gh pr merge --squash --delete-branch`
   - Optionally pulls main: `git pull origin main`

### Changes Requested

If the reviewer reports `changes_requested`:
1. Transition to `implementing` with `start_agent(mode: 'revision', agentType: 'implementor', revisionReason: 'changes_requested')`
2. Agent receives review comments as context
3. On completion, cycles back to `push_and_create_pr` → PR reviewer

## Branch Naming

### Single-phase tasks

```
task/{taskId}/{agentType}
```

Example: `task/abc-123-def/implementor`

The branch is created when the first agent runs for a task. Subsequent agents for the same task reuse the same worktree (and branch).

### Multi-phase tasks

For tasks with multiple implementation phases, the branch naming includes a phase index:

```
task/{taskId}/{agentType}/phase-{n}
```

Example: `task/abc-123-def/implementor/phase-1`, `task/abc-123-def/implementor/phase-2`

Each phase gets its own branch (and worktree). The phase index is 1-based.

## Shell Environment Resolution

**File:** `src/main/services/shell-env.ts`

Electron GUI apps on macOS launch with a minimal PATH that doesn't include tools from nvm, fnm, Homebrew, etc.

### Eager Initialization

`initShellEnv()` is called during app startup (in `onReady`, before `createAppServices`). It asynchronously resolves the user's shell PATH using `execFile` (non-blocking) and populates the module-level cache. This prevents the synchronous fallback from blocking the event loop on first git operation.

### PATH Resolution

`getUserShellPath()` resolves the user's real PATH. If `initShellEnv()` was called at startup, this is an instant cache hit. Otherwise it falls back to synchronous exec:

1. **Try login shell** — `$SHELL -l -c "echo $PATH"` (with 5s timeout)
2. **Try zsh** — `/bin/zsh -li -c "echo $PATH"`
3. **Try bash** — `/bin/bash -l -c "echo $PATH"`
4. **Fallback: scan directories** — Checks actual filesystem for:
   - Homebrew: `/opt/homebrew/bin`, `/usr/local/bin`
   - nvm: `~/.nvm/versions/node/*/bin`
   - fnm: `~/.local/share/fnm/node-versions/*/installation/bin`
   - asdf: `~/.asdf/installs/nodejs/*/bin`
   - Bun: `~/.bun/bin`
   - Volta: `~/.volta/bin`
   - Cargo: `~/.cargo/bin`

Result is cached for the app's lifetime. `getShellEnv()` returns `process.env` with PATH and HOME set.

## Edge Cases

- **Rebase failure** is non-fatal — the rebase is aborted and logged as a warning. The agent's existing commits are preserved.
- **No-changes** skips PR creation entirely. If `git diff origin/main` is empty, the `push_and_create_pr` hook logs a warning and returns without pushing or creating a PR.
- **Force-push** is used after rebase because rebase rewrites history. `--force-with-lease` is used for safety.
- **`.agent-worktrees/`** is auto-added to `.gitignore` on first worktree creation, using atomic file operations.
- **`node_modules` symlink** is created inside each worktree pointing to the main project's `node_modules`. This avoids reinstalling dependencies and ensures native modules work.
- **Concurrent CLI + Electron** can both access worktrees. The lock mechanism prevents two agents from using the same worktree simultaneously.
- **Shell environment** is eagerly initialized at app startup via `initShellEnv()`. The CLI uses synchronous fallback. If the user installs new tools after app launch, a restart is needed.
- **Idempotent operations** — `lock()`, `unlock()`, and `delete()` all tolerate already-in-desired-state errors, making them safe to call multiple times.
