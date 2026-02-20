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
  cleanup(): Promise<void>;
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

### Worktree Lifecycle

1. **Create** — `worktreeManager.create(branch, taskId)`
   - Fetches `origin` first (to base on `origin/main`, not local main)
   - Runs `git worktree add -b {branch} {path} origin/main`
   - If the branch already exists, retries without `-b` flag
   - Returns a `Worktree` object

2. **Lock** — `worktreeManager.lock(taskId)`
   - Called at the start of agent execution to prevent concurrent access

3. **Unlock** — `worktreeManager.unlock(taskId)`
   - Called after agent execution completes

4. **Delete** — `worktreeManager.delete(taskId)`
   - Runs `git worktree remove --force {path}`
   - Called on final status transitions, task reset, and task delete

5. **Cleanup** — `worktreeManager.cleanup()`
   - Prunes orphaned worktrees via `git worktree prune`
   - Removes unlocked worktrees

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
1. Transition to `implementing` with `start_agent(mode: 'request_changes')`
2. Agent receives review comments as context
3. On completion, cycles back to `push_and_create_pr` → PR reviewer

## Branch Naming

```
task/{taskId}/{mode}
```

Example: `task/abc-123-def/implement`

The branch is created when the first agent runs for a task. Subsequent agents for the same task reuse the same worktree (and branch).

## Shell Environment Resolution

**File:** `src/main/services/shell-env.ts`

Electron GUI apps on macOS launch with a minimal PATH that doesn't include tools from nvm, fnm, Homebrew, etc.

`getUserShellPath()` resolves the user's real PATH:

1. **Try login shell** — `$SHELL -l -c "echo $PATH"` (with 5s timeout)
2. **Try zsh** — `/bin/zsh -li -c "echo $PATH"`
3. **Try bash** — `/bin/bash -l -c "echo $PATH"`
4. **Fallback: scan directories** — Checks actual filesystem for:
   - nvm: `~/.nvm/versions/node/*/bin`
   - fnm: `~/.local/share/fnm/node-versions/*/installation/bin`
   - volta: `~/.volta/bin`
   - asdf: `~/.asdf/installs/nodejs/*/bin`
   - Homebrew: `/opt/homebrew/bin`, `/usr/local/bin`
   - Bun: `~/.bun/bin`

Result is cached for the app's lifetime. `getShellEnv()` returns `process.env` with PATH and HOME set.

## Edge Cases

- **Rebase failure** is non-fatal — the rebase is aborted and logged as a warning. The agent's existing commits are preserved.
- **No-changes** skips PR creation entirely. If `git diff origin/main` is empty, the `push_and_create_pr` hook logs a warning and returns without pushing or creating a PR.
- **Force-push** is used after rebase because rebase rewrites history. `--force-with-lease` is used for safety.
- **`.agent-worktrees/`** is auto-added to `.gitignore` on first worktree creation, using atomic file operations.
- **Concurrent CLI + Electron** can both access worktrees. The lock mechanism prevents two agents from using the same worktree simultaneously.
- **Shell environment** is resolved once and cached. If the user installs new tools after app launch, a restart is needed.
