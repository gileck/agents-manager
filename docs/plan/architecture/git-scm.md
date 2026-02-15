# Git/GitHub Source Code Management

All git operations, worktree management, and SCM platform integration (GitHub, GitLab) for the Agents Manager app. These three abstractions provide the foundation for agent isolation, branch management, and pull request workflows.

See also: [agent-platform.md](agent-platform.md) | [overview.md](overview.md) | [workflow-service.md](workflow-service.md)

---

## Overview

Three separate interfaces cover the full SCM surface:

```
                         ┌─────────────────────────────────────────────────┐
                         │               WorkflowService                   │
                         │        (orchestrates all three below)            │
                         └───────┬──────────────┬──────────────┬───────────┘
                                 │              │              │
                    ┌────────────▼──┐   ┌───────▼───────┐  ┌──▼──────────────┐
                    │   IGitOps      │   │ IWorktreeManager│  │  IScmPlatform    │
                    │                │   │                │  │                  │
                    │ Local git CLI  │   │ git worktree   │  │ GitHub/GitLab    │
                    │ branch, commit │   │ create, lock,  │  │ PRs, issues,     │
                    │ diff, push     │   │ cleanup        │  │ repo info        │
                    └────────────────┘   └────────────────┘  └──────────────────┘
```

- **IGitOps** -- low-level git operations (branch, status, diff, commit, push). Thin wrapper around the `git` binary.
- **IWorktreeManager** -- creates and manages isolated working directories so multiple agents can run on the same repo simultaneously without branch-switching conflicts.
- **IScmPlatform** -- interacts with the remote hosting platform (GitHub, GitLab, Bitbucket) for pull requests, issues, and repo metadata.

These are critical infrastructure. Agents work inside worktrees, create branches and commits through `IGitOps`, and PRs are created/merged through `IScmPlatform`. The `WorkflowService` orchestrates all three to keep the task pipeline in sync with the actual git state.

---

## Git Operations Interface (`IGitOps`)

Abstracts git commands. Phase 1: local git CLI via `child_process`. Future: could use libgit2 or a remote git service.

```typescript
// src/main/interfaces/git-ops.ts

interface IGitOps {
  // Branch operations
  getCurrentBranch(repoPath: string): Promise<string>;
  createBranch(repoPath: string, branchName: string, baseBranch?: string): Promise<void>;
  checkoutBranch(repoPath: string, branchName: string): Promise<void>;
  deleteBranch(repoPath: string, branchName: string): Promise<void>;
  listBranches(repoPath: string): Promise<string[]>;

  // Status
  getStatus(repoPath: string): Promise<GitStatus>;
  isClean(repoPath: string): Promise<boolean>;

  // Diff
  getDiff(repoPath: string, options?: DiffOptions): Promise<FileDiff[]>;
  getDiffStats(repoPath: string, options?: DiffOptions): Promise<DiffStats>;

  // Commit
  stageAll(repoPath: string): Promise<void>;
  commit(repoPath: string, message: string): Promise<string>; // returns commit hash
  getLog(repoPath: string, options?: LogOptions): Promise<GitLogEntry[]>;

  // Remote
  push(repoPath: string, branch: string, remote?: string): Promise<void>;
  pull(repoPath: string, branch: string, remote?: string): Promise<void>;

  // Generic exec (for operations not covered above)
  exec(repoPath: string, args: string[]): Promise<string>;
}
```

### Supporting Types

```typescript
interface GitStatus {
  branch: string;
  clean: boolean;
  staged: string[];
  modified: string[];
  untracked: string[];
}

interface DiffOptions {
  baseBranch?: string;   // compare against this branch (e.g., "main")
  headBranch?: string;   // compare this branch (e.g., "agent/add-auth-abc123")
  paths?: string[];      // limit to specific files
  cached?: boolean;      // staged changes only
}

interface FileDiff {
  filePath: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

interface DiffStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}

interface LogOptions {
  limit?: number;
  since?: string;       // ISO date string
  branch?: string;
}

interface GitLogEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}
```

### Phase 1 Implementation: `LocalGitOps`

Runs `git` commands via `child_process.execFile`. Every method constructs a `git` argument array and executes it in the given `repoPath`.

```typescript
// src/main/implementations/local-git-ops.ts

import { execFile } from 'child_process';
import { getUserShellPath } from '../utils/shell-path';

export class LocalGitOps implements IGitOps {
  private async git(repoPath: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd: repoPath,
        env: {
          ...process.env,
          PATH: getUserShellPath(),  // critical for Electron GUI apps
        },
        maxBuffer: 10 * 1024 * 1024, // 10MB for large diffs
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(`git ${args[0]} failed: ${stderr || err.message}`));
        else resolve(stdout.trim());
      });
    });
  }

  async getCurrentBranch(repoPath: string): Promise<string> {
    return this.git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  }

  async createBranch(repoPath: string, branchName: string, baseBranch?: string): Promise<void> {
    const args = ['checkout', '-b', branchName];
    if (baseBranch) args.push(baseBranch);
    await this.git(repoPath, args);
  }

  async getStatus(repoPath: string): Promise<GitStatus> {
    const branch = await this.getCurrentBranch(repoPath);
    const porcelain = await this.git(repoPath, ['status', '--porcelain']);

    const staged: string[] = [];
    const modified: string[] = [];
    const untracked: string[] = [];

    for (const line of porcelain.split('\n').filter(Boolean)) {
      const x = line[0]; // index status
      const y = line[1]; // working tree status
      const file = line.slice(3);

      if (x === '?') untracked.push(file);
      else if (x !== ' ') staged.push(file);
      if (y !== ' ' && y !== '?') modified.push(file);
    }

    return { branch, clean: porcelain === '', staged, modified, untracked };
  }

  async isClean(repoPath: string): Promise<boolean> {
    const status = await this.getStatus(repoPath);
    return status.clean;
  }

  async commit(repoPath: string, message: string): Promise<string> {
    await this.git(repoPath, ['commit', '-m', message]);
    return this.git(repoPath, ['rev-parse', 'HEAD']);
  }

  async getDiffStats(repoPath: string, options?: DiffOptions): Promise<DiffStats> {
    const args = ['diff', '--stat', '--numstat'];
    if (options?.cached) args.push('--cached');
    if (options?.baseBranch && options?.headBranch) {
      args.push(`${options.baseBranch}...${options.headBranch}`);
    }
    if (options?.paths) args.push('--', ...options.paths);

    const output = await this.git(repoPath, args);
    const lines = output.split('\n').filter(Boolean);

    let additions = 0, deletions = 0;
    for (const line of lines) {
      const [add, del] = line.split('\t');
      additions += parseInt(add) || 0;
      deletions += parseInt(del) || 0;
    }

    return { filesChanged: lines.length, additions, deletions };
  }

  async push(repoPath: string, branch: string, remote = 'origin'): Promise<void> {
    await this.git(repoPath, ['push', '-u', remote, branch]);
  }

  async exec(repoPath: string, args: string[]): Promise<string> {
    return this.git(repoPath, args);
  }

  // ... remaining methods follow the same pattern
}
```

### PATH Resolution (Electron GUI Apps)

Electron GUI apps on macOS do **not** inherit the user's shell PATH. When launched from the Dock or Finder, the process PATH only contains `/usr/bin:/bin:/usr/sbin:/sbin`. This means `git`, `node`, `npm`, and anything installed via nvm, fnm, Homebrew, or Volta is invisible.

`getUserShellPath()` solves this by:
1. Spawning the user's login shell to read the full PATH
2. Falling back to scanning known directories (`~/.nvm/versions/node/*/bin`, `/opt/homebrew/bin`, etc.)

Every `LocalGitOps` command passes this resolved PATH in the `env` option. The same utility is used by the agent execution layer (see `agent-platform.md`).

---

## Worktree Manager Interface (`IWorktreeManager`)

Manages git worktrees for agent isolation. When multiple agents run on different tasks in the same project, each needs its own working directory. Worktrees let multiple branches be checked out simultaneously from the same repo without conflicts.

```typescript
// src/main/interfaces/worktree-manager.ts

interface IWorktreeManager {
  // Create a worktree for an agent to work in
  create(repoPath: string, options: CreateWorktreeOptions): Promise<Worktree>;

  // Get existing worktree by branch name or task ID
  get(repoPath: string, identifier: string): Promise<Worktree | null>;

  // List all worktrees for a repo
  list(repoPath: string): Promise<Worktree[]>;

  // Lock a worktree (agent is running in it)
  lock(worktreePath: string, reason?: string): Promise<void>;

  // Unlock a worktree (agent finished)
  unlock(worktreePath: string): Promise<void>;

  // Delete a specific worktree
  delete(worktreePath: string, force?: boolean): Promise<void>;

  // Clean up stale/orphaned worktrees (no running agent, task done/cancelled)
  cleanup(repoPath: string): Promise<CleanupReport>;
}
```

### Supporting Types

```typescript
interface Worktree {
  path: string;           // absolute path to the worktree directory
  branch: string;         // branch checked out in this worktree
  taskId?: string;        // task this worktree was created for
  isMain: boolean;        // is this the main working tree
  isLocked: boolean;      // agent is currently running in this worktree
  lockReason?: string;    // e.g., "agent run abc-123"
  createdAt: string;
}

interface CreateWorktreeOptions {
  branchName: string;       // branch to checkout in the worktree
  baseBranch?: string;      // create new branch from this base (default: main/master)
  createBranch?: boolean;   // create the branch if it doesn't exist (default: true)
  taskId?: string;          // associate with a task (for cleanup tracking)
}

interface CleanupReport {
  removed: number;
  paths: string[];
  errors: string[];
}
```

### Why Worktrees

The main repo stays on its current branch (usually `main`). Agents never touch it. Without worktrees, running an agent on a task would require:
1. Switching the repo to a feature branch (disrupts any other work)
2. Running the agent
3. Switching back

With worktrees:
- Each agent gets its own directory with a full working copy on its own branch
- Multiple agents can work on different tasks in the same project simultaneously
- No branch-switching conflicts, no stashed changes, no interrupted workflows

### Storage Convention

```
<project-path>/.agent-worktrees/
├── task-abc-123/          # worktree for task abc-123
│   ├── src/               # full working copy on branch agent/add-auth-abc12345
│   ├── package.json
│   └── ...
├── task-def-456/          # worktree for task def-456
│   ├── src/
│   └── ...
└── .gitkeep
```

Worktrees live inside the project directory under `.agent-worktrees/`. The directory name is derived from the task ID for easy identification.

### `.gitignore` Auto-Update

On first worktree creation for a project, `LocalWorktreeManager` checks the project's `.gitignore` and appends if missing:

```
# Agent worktrees (managed by agents-manager)
.agent-worktrees/
```

This prevents worktree directories from being committed to the repo.

### Lifecycle

```
Agent starts task
    │
    ▼
worktreeManager.create()
    │  Creates .agent-worktrees/<task-id>/
    │  Checks out branch (creates if needed)
    │  Agent's cwd is set to the worktree path
    ▼
worktreeManager.lock(path, "agent run for task abc-123")
    │  Prevents accidental cleanup while agent runs
    ▼
Agent runs (reads code, writes code, commits, pushes)
    │  All file operations happen inside the worktree
    │  Main repo is untouched
    ▼
worktreeManager.unlock(path)
    │  Agent finished — worktree kept for review/retry
    ▼
Task reaches terminal status (done/cancelled)
    │
    ▼
worktreeManager.cleanup(repoPath)
    │  Supervisor runs this periodically
    │  Removes worktrees for completed/cancelled tasks
    ▼
Worktree deleted, branch kept on remote
```

### Implementation: `LocalWorktreeManager`

Uses `git worktree add/remove/list` and `git worktree lock/unlock` via `child_process`:

```typescript
// src/main/implementations/local-worktree-manager.ts

export class LocalWorktreeManager implements IWorktreeManager {
  constructor(private gitOps: IGitOps) {}

  async create(repoPath: string, options: CreateWorktreeOptions): Promise<Worktree> {
    const worktreeDir = path.join(repoPath, '.agent-worktrees', options.taskId || options.branchName);

    // Ensure .agent-worktrees/ is in .gitignore
    await this.ensureGitignore(repoPath);

    // Create the worktree
    const args = ['worktree', 'add'];
    if (options.createBranch !== false) {
      args.push('-b', options.branchName);
    }
    args.push(worktreeDir);
    if (options.baseBranch) {
      args.push(options.baseBranch);
    }

    await this.gitOps.exec(repoPath, args);

    return {
      path: worktreeDir,
      branch: options.branchName,
      taskId: options.taskId,
      isMain: false,
      isLocked: false,
      createdAt: new Date().toISOString(),
    };
  }

  async list(repoPath: string): Promise<Worktree[]> {
    const output = await this.gitOps.exec(repoPath, ['worktree', 'list', '--porcelain']);
    return this.parsePorcelainOutput(output);
  }

  async lock(worktreePath: string, reason?: string): Promise<void> {
    const args = ['worktree', 'lock', worktreePath];
    if (reason) args.push('--reason', reason);
    // lock is run from the worktree's parent repo
    const repoPath = path.resolve(worktreePath, '..', '..');
    await this.gitOps.exec(repoPath, args);
  }

  async unlock(worktreePath: string): Promise<void> {
    const repoPath = path.resolve(worktreePath, '..', '..');
    await this.gitOps.exec(repoPath, ['worktree', 'unlock', worktreePath]);
  }

  async delete(worktreePath: string, force?: boolean): Promise<void> {
    const repoPath = path.resolve(worktreePath, '..', '..');
    const args = ['worktree', 'remove', worktreePath];
    if (force) args.push('--force');
    await this.gitOps.exec(repoPath, args);
  }

  async cleanup(repoPath: string): Promise<CleanupReport> {
    const worktrees = await this.list(repoPath);
    const removed: string[] = [];
    const errors: string[] = [];

    for (const wt of worktrees) {
      if (wt.isMain || wt.isLocked) continue;

      // Only remove worktrees in the .agent-worktrees/ directory
      if (!wt.path.includes('.agent-worktrees')) continue;

      try {
        await this.delete(wt.path);
        removed.push(wt.path);
      } catch (err) {
        errors.push(`Failed to remove ${wt.path}: ${err.message}`);
      }
    }

    // Also run git's built-in prune for any broken worktree refs
    await this.gitOps.exec(repoPath, ['worktree', 'prune']);

    return { removed: removed.length, paths: removed, errors };
  }

  private async ensureGitignore(repoPath: string): Promise<void> {
    const gitignorePath = path.join(repoPath, '.gitignore');
    const entry = '.agent-worktrees/';

    try {
      const content = await fs.readFile(gitignorePath, 'utf-8');
      if (content.includes(entry)) return; // already there
      await fs.appendFile(gitignorePath, `\n# Agent worktrees (managed by agents-manager)\n${entry}\n`);
    } catch {
      // No .gitignore exists -- create one
      await fs.writeFile(gitignorePath, `# Agent worktrees (managed by agents-manager)\n${entry}\n`);
    }
  }

  private parsePorcelainOutput(output: string): Worktree[] {
    // Parse `git worktree list --porcelain` output
    // Each worktree block is separated by a blank line
    // Fields: worktree <path>, HEAD <hash>, branch refs/heads/<name>, locked [<reason>]
    const blocks = output.split('\n\n').filter(Boolean);
    return blocks.map(block => {
      const lines = block.split('\n');
      const wtPath = lines.find(l => l.startsWith('worktree '))?.slice(9) || '';
      const branch = lines.find(l => l.startsWith('branch '))?.slice(7).replace('refs/heads/', '') || '';
      const isLocked = lines.some(l => l.startsWith('locked'));
      const lockReason = lines.find(l => l.startsWith('locked '))?.slice(7);
      const isBare = lines.some(l => l === 'bare');

      return {
        path: wtPath,
        branch,
        isMain: !wtPath.includes('.agent-worktrees'),
        isLocked,
        lockReason,
        createdAt: '', // git worktree list doesn't provide creation time
      };
    });
  }
}
```

### Supervisor Integration

The `TaskSupervisor` (background health loop) calls `worktreeManager.cleanup()` on each tick. Cleanup only removes worktrees that are:
- Not locked (no running agent)
- Inside `.agent-worktrees/` (never touches the main working tree)
- Associated with tasks in terminal status (done, cancelled)

The supervisor also detects stale locks: if a worktree is locked but no agent process is running for that task, it unlocks the worktree so it can be cleaned up on the next tick.

---

## SCM Platform Interface (`IScmPlatform`)

Interacts with the source code hosting platform. Phase 1: GitHub via `gh` CLI. Future: GitLab, Bitbucket.

```typescript
// src/main/interfaces/scm-platform.ts

interface IScmPlatform {
  readonly name: string; // 'github', 'gitlab', 'bitbucket'

  // Check if authenticated / available
  isAvailable(): Promise<boolean>;

  // Pull Requests
  createPR(options: CreatePROptions): Promise<PullRequest>;
  getPR(repoUrl: string, prNumber: number): Promise<PullRequest>;
  listPRs(repoUrl: string, filters?: PRFilters): Promise<PullRequest[]>;
  mergePR(repoUrl: string, prNumber: number): Promise<void>;

  // Issues (for import)
  listIssues(repoUrl: string, filters?: IssueFilters): Promise<ScmIssue[]>;
  getIssue(repoUrl: string, issueNumber: number): Promise<ScmIssue>;

  // Repo info
  getRepoInfo(repoPath: string): Promise<RepoInfo | null>;
}
```

### Supporting Types

```typescript
interface CreatePROptions {
  repoUrl: string;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
  draft?: boolean;
}

interface PullRequest {
  number: number;
  title: string;
  body: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  headBranch: string;
  baseBranch: string;
  createdAt: string;
}

interface PRFilters {
  state?: 'open' | 'closed' | 'all';
  author?: string;
  limit?: number;
}

interface ScmIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  url: string;
  createdAt: string;
}

interface IssueFilters {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  limit?: number;
}

interface RepoInfo {
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
}
```

### Phase 1 Implementation: `GitHubPlatform`

Uses the `gh` CLI (GitHub's official command-line tool) for all operations. This avoids managing OAuth tokens directly -- `gh auth login` handles authentication, and `gh auth status` verifies it.

```typescript
// src/main/implementations/github-platform.ts

import { execFile } from 'child_process';
import { getUserShellPath } from '../utils/shell-path';

export class GitHubPlatform implements IScmPlatform {
  readonly name = 'github';

  private async gh(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('gh', args, {
        cwd,
        env: { ...process.env, PATH: getUserShellPath() },
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(`gh ${args[0]} failed: ${stderr || err.message}`));
        else resolve(stdout.trim());
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.gh(['auth', 'status']);
      return true;
    } catch {
      return false;
    }
  }

  async createPR(options: CreatePROptions): Promise<PullRequest> {
    const args = [
      'pr', 'create',
      '--title', options.title,
      '--body', options.body,
      '--head', options.headBranch,
      '--base', options.baseBranch,
      '--json', 'number,title,body,url,state,headRefName,baseRefName,createdAt',
    ];
    if (options.draft) args.push('--draft');

    const output = await this.gh(args, this.repoDir(options.repoUrl));
    const data = JSON.parse(output);

    return {
      number: data.number,
      title: data.title,
      body: data.body,
      url: data.url,
      state: data.state.toLowerCase(),
      headBranch: data.headRefName,
      baseBranch: data.baseRefName,
      createdAt: data.createdAt,
    };
  }

  async getPR(repoUrl: string, prNumber: number): Promise<PullRequest> {
    const output = await this.gh([
      'pr', 'view', String(prNumber),
      '--repo', repoUrl,
      '--json', 'number,title,body,url,state,headRefName,baseRefName,createdAt',
    ]);
    const data = JSON.parse(output);

    return {
      number: data.number,
      title: data.title,
      body: data.body,
      url: data.url,
      state: this.mapPRState(data.state),
      headBranch: data.headRefName,
      baseBranch: data.baseRefName,
      createdAt: data.createdAt,
    };
  }

  async listPRs(repoUrl: string, filters?: PRFilters): Promise<PullRequest[]> {
    const args = [
      'pr', 'list',
      '--repo', repoUrl,
      '--json', 'number,title,body,url,state,headRefName,baseRefName,createdAt',
      '--limit', String(filters?.limit || 30),
    ];
    if (filters?.state) args.push('--state', filters.state);
    if (filters?.author) args.push('--author', filters.author);

    const output = await this.gh(args);
    const items = JSON.parse(output);
    return items.map((d: any) => ({
      number: d.number,
      title: d.title,
      body: d.body,
      url: d.url,
      state: this.mapPRState(d.state),
      headBranch: d.headRefName,
      baseBranch: d.baseRefName,
      createdAt: d.createdAt,
    }));
  }

  async mergePR(repoUrl: string, prNumber: number): Promise<void> {
    await this.gh([
      'pr', 'merge', String(prNumber),
      '--repo', repoUrl,
      '--squash',       // squash merge by default
      '--delete-branch', // clean up remote branch
    ]);
  }

  async listIssues(repoUrl: string, filters?: IssueFilters): Promise<ScmIssue[]> {
    const args = [
      'issue', 'list',
      '--repo', repoUrl,
      '--json', 'number,title,body,state,labels,url,createdAt',
      '--limit', String(filters?.limit || 30),
    ];
    if (filters?.state) args.push('--state', filters.state);
    if (filters?.labels?.length) args.push('--label', filters.labels.join(','));

    const output = await this.gh(args);
    const items = JSON.parse(output);
    return items.map((d: any) => ({
      number: d.number,
      title: d.title,
      body: d.body,
      state: d.state,
      labels: d.labels.map((l: any) => l.name),
      url: d.url,
      createdAt: d.createdAt,
    }));
  }

  async getIssue(repoUrl: string, issueNumber: number): Promise<ScmIssue> {
    const output = await this.gh([
      'issue', 'view', String(issueNumber),
      '--repo', repoUrl,
      '--json', 'number,title,body,state,labels,url,createdAt',
    ]);
    const data = JSON.parse(output);
    return {
      number: data.number,
      title: data.title,
      body: data.body,
      state: data.state,
      labels: data.labels.map((l: any) => l.name),
      url: data.url,
      createdAt: data.createdAt,
    };
  }

  async getRepoInfo(repoPath: string): Promise<RepoInfo | null> {
    try {
      const output = await this.gh([
        'repo', 'view',
        '--json', 'owner,name,url,defaultBranchRef',
      ], repoPath);
      const data = JSON.parse(output);
      return {
        owner: data.owner.login,
        name: data.name,
        url: data.url,
        defaultBranch: data.defaultBranchRef.name,
      };
    } catch {
      return null; // not a GitHub repo, or gh not authenticated
    }
  }

  private mapPRState(state: string): 'open' | 'closed' | 'merged' {
    switch (state.toUpperCase()) {
      case 'MERGED': return 'merged';
      case 'CLOSED': return 'closed';
      default: return 'open';
    }
  }

  private repoDir(repoUrl: string): string | undefined {
    // If repoUrl is a local path, use it as cwd for gh commands
    // If it's a URL, gh --repo handles it
    return undefined;
  }
}
```

---

## PR Lifecycle

Pull requests are the primary mechanism for getting agent-written code reviewed and merged. The flow differs for single-phase and multi-phase tasks.

### Single-Phase Task (branch → main)

```
1. Agent implements code in worktree
   Creates commits, pushes branch
2. Agent platform creates PR: branch → main
   IScmPlatform.createPR({ headBranch, baseBranch: 'main' })
3. PR stored as task artifact (phaseId: null)
   type: 'pull_request', metadata: { prNumber, state: 'open' }
4. Task transitions to pr_review
5. Review (agent or human)
6. User clicks "Merge & Complete"
   WorkflowService.mergePR(taskId)
   → squash merge + delete branch
7. PR artifact updated: state → 'merged'
8. Task transitions to done
```

### Multi-Phase Task (phase branches → task branch → main)

```
Phase lifecycle (repeats for each phase):
  1. create_task_branch hook creates task branch from main (first phase only)
  2. start_phase_agent hook creates phase branch from task branch
     Agent runs in worktree, makes commits
  3. Agent platform creates phase PR: phase branch → task branch
     PR stored as phase-scoped artifact (phaseId set)
  4. Phase PR reviewed (optional — can be auto-merged)
  5. merge_phase_pr hook merges phase PR into task branch
     Phase status → completed
  6. advance_phase hook starts next phase (or creates final PR if last)

Final PR:
  7. create_final_pr hook creates PR: task branch → main
     PR stored as task-level artifact (phaseId: null)
  8. Task transitions to pr_review
  9. Review shows the full feature (all phases combined)
  10. merge_final_pr merges to main → task transitions to done
```

### Workflow-Only Merge Rule

PRs are merged **exclusively through the WorkflowService** -- never manually on GitHub. This is a deliberate constraint:

```typescript
// In WorkflowServiceImpl — handles both single-phase and final PR merges
async mergePR(taskId: string): Promise<void> {
  const task = await this.taskStore.getTask(taskId);

  // Find the task-level open PR (single-phase PR or final PR)
  const prArtifact = (await this.taskStore.listArtifacts(taskId, 'pull_request'))
    .find(a => a.metadata.state === 'open' && !a.phaseId);

  if (!prArtifact) throw new Error('No open PR found for this task');

  const project = await this.projectStore.getById(task.projectId);
  const repoInfo = await this.scmPlatform.getRepoInfo(project.path);

  // Merge the PR on GitHub
  await this.scmPlatform.mergePR(repoInfo.url, prArtifact.metadata.prNumber);

  // Update the artifact
  await this.taskStore.updateArtifact(prArtifact.id, {
    metadata: { ...prArtifact.metadata, state: 'merged', mergedAt: new Date().toISOString() },
  });

  // Trigger pipeline transition to done
  await this.pipelineEngine.transition(taskId, 'done', {
    triggeredBy: 'user',
    reason: `PR #${prArtifact.metadata.prNumber} merged`,
  });
}

// Separate method for merging phase PRs into the task branch
async mergePhasePR(taskId: string, phaseId: string): Promise<void> {
  const prArtifact = (await this.taskStore.listArtifacts(taskId, 'pull_request'))
    .find(a => a.metadata.state === 'open' && a.phaseId === phaseId);

  if (!prArtifact) throw new Error('No open PR for this phase');

  const project = await this.projectStore.getById(
    (await this.taskStore.getTask(taskId)).projectId
  );
  const repoInfo = await this.scmPlatform.getRepoInfo(project.path);

  // Merge phase PR into task branch
  await this.scmPlatform.mergePR(repoInfo.url, prArtifact.metadata.prNumber);

  // Update artifact
  await this.taskStore.updateArtifact(prArtifact.id, {
    metadata: { ...prArtifact.metadata, state: 'merged', mergedAt: new Date().toISOString() },
  });

  // Mark phase as completed
  await this.taskStore.updatePhase(phaseId, { status: 'completed' });

  // advance_phase hook handles starting the next phase or creating final PR
}
```

If someone merges manually on GitHub, the task stays in `pr_review` status and the pipeline is out of sync. This is logged as a warning by the supervisor. The admin can manually transition the task to `done` via the UI if needed, but the preferred path is always through the WorkflowService.

---

## Branch Naming Convention

### Single-Phase Tasks

For tasks without phases, the agent branches directly from `main` and PRs back to `main`:

```typescript
function resolveTaskBranchName(task: Task, config: ProjectConfig): string {
  // Check for existing branch artifact first (reuse on retry)
  const branchArtifact = await taskStore.listArtifacts(task.id, 'branch')
    .then(a => a.find(b => !b.phaseId));
  if (branchArtifact) return branchArtifact.metadata.branchName;

  const prefix = config.git?.branchPrefix || 'agents-manager/';
  const slug = slugify(task.title, { lower: true, strict: true }).slice(0, 40);
  return `${prefix}${slug}-${task.id.slice(0, 8)}`;
  // e.g., "agents-manager/add-auth-middleware-abc12345"
}
```

### Multi-Phase Tasks

Multi-phase tasks use a **task branch as integration branch**. Phase branches are created from and merged back into the task branch. A final PR merges the task branch into `main`.

```
main ───────────────────────────────────────────────────
  └── agents-manager/add-auth-abc123           (task branch)
        ├── agents-manager/add-auth-abc123/backend    (phase 1)
        ├── agents-manager/add-auth-abc123/frontend   (phase 2)
        └── agents-manager/add-auth-abc123/tests      (phase 3)
```

```typescript
function resolveTaskBranchName(task: Task, config: ProjectConfig): string {
  const prefix = config.git?.branchPrefix || 'agents-manager/';
  const slug = slugify(task.title, { lower: true, strict: true }).slice(0, 40);
  return `${prefix}${slug}-${task.id.slice(0, 8)}`;
  // e.g., "agents-manager/add-auth-abc123"
}

function resolvePhaseBranchName(task: Task, phase: TaskPhase, config: ProjectConfig): string {
  const taskBranch = resolveTaskBranchName(task, config);
  const phaseSlug = slugify(phase.name, { lower: true, strict: true }).slice(0, 30);
  return `${taskBranch}/${phaseSlug}`;
  // e.g., "agents-manager/add-auth-abc123/backend-api"
}
```

### Branching rules

| Scenario | Base branch | PR target |
|----------|-------------|-----------|
| Single-phase task | `main` | `main` |
| Task branch (multi-phase) | `main` | — (no PR until final) |
| Phase branch | task branch | task branch |
| Final PR (multi-phase) | task branch | `main` |

**Design decisions:**
- Prefix (default `agents-manager/`) makes it easy to distinguish agent-created branches from human branches
- Task title slug gives the branch a human-readable name
- Task ID suffix (first 8 chars) ensures uniqueness even if two tasks have similar titles
- Slugified to 40/30 characters max to avoid hitting git/GitHub length limits
- Reuses existing branch on retry — an agent that fails and retries picks up where it left off (looks for existing `branch` artifact)
- Phase slug is appended as a sub-path for clear hierarchy in `git branch --list`

---

## Diff Service

The diff service provides the data behind the UI's diff viewer. When a user opens a task that has an agent branch, they can see exactly what the agent changed relative to the base branch.

### How It Works

```typescript
// Called by the IPC handler for the DiffViewer component
async function getTaskDiff(taskId: string, phaseId?: string): Promise<FileDiff[]> {
  const task = await taskStore.getTask(taskId);
  const project = await projectStore.getById(task.projectId);

  // Find the branch artifact — scoped to phase if provided
  const branches = await taskStore.listArtifacts(task.id, 'branch');
  const branch = phaseId
    ? branches.find(b => b.phaseId === phaseId)
    : branches.find(b => !b.phaseId);
  if (!branch) return [];

  // For phase branches, diff against task branch. For task/single branches, diff against main.
  const baseBranch = phaseId
    ? branches.find(b => !b.phaseId)?.metadata.branchName || 'main'
    : project.config.defaultBranch || 'main';

  return gitOps.getDiff(project.path, {
    baseBranch,
    headBranch: branch.metadata.branchName,
  });
}
```

### Usage in the UI

The renderer calls these through IPC:

```typescript
// src/renderer/hooks/useTaskDiff.ts
function useTaskDiff(taskId: string) {
  return useQuery(['task-diff', taskId], () =>
    window.api.invoke('git:task-diff', taskId)
  );
}

// Rendered in DiffViewer component
// Shows file list with additions/deletions per file
// Expandable hunks with syntax-highlighted add/delete/context lines
```

### Diff Stats as Artifacts

After an agent completes, the artifact collector stores diff stats on the task:

```typescript
await taskStore.addArtifact(task.id, {
  type: 'diff',
  label: `+${stats.additions} -${stats.deletions} across ${stats.filesChanged} files`,
  metadata: stats,
});
```

These stats appear on the task card in the kanban board and in the task detail view, giving a quick sense of scope before opening the full diff viewer.

---

## File Structure

```
src/main/
├── interfaces/
│   ├── git-ops.ts                 # IGitOps interface + GitStatus, DiffOptions, FileDiff,
│   │                              #   DiffHunk, DiffLine, DiffStats, LogOptions, GitLogEntry
│   ├── worktree-manager.ts        # IWorktreeManager + Worktree, CreateWorktreeOptions,
│   │                              #   CleanupReport
│   └── scm-platform.ts            # IScmPlatform + CreatePROptions, PullRequest, PRFilters,
│                                  #   ScmIssue, IssueFilters, RepoInfo
├── implementations/
│   ├── local-git-ops.ts           # git CLI wrapper via child_process
│   ├── local-worktree-manager.ts  # git worktree commands via IGitOps.exec
│   └── github-platform.ts        # gh CLI wrapper via child_process
└── utils/
    └── shell-path.ts              # getUserShellPath() for Electron GUI PATH resolution
```

All three interfaces are imported by the composition root (`src/main/providers/setup.ts`) and injected into the `WorkflowService`, pipeline handlers (`GitHandler`, `PrReviewHandler`), and `AgentService` via constructor injection. See [overview.md](overview.md) for the full dependency graph.

---

## Phase Rollout

### Phase 1: Stubs

- `IGitOps` interface defined, `LocalGitOps` stub (methods not called yet -- no agents)
- `IScmPlatform` interface defined, `GitHubPlatform` stub
- `IWorktreeManager` interface defined, not implemented yet
- All three wired into composition root for type-safety, but no code paths reach them

### Phase 2: Full Git + Worktrees + Basic SCM

- **IGitOps**: full implementation -- all branch, status, diff, commit, push/pull operations
- **IWorktreeManager**: full implementation -- create, lock, unlock, delete, cleanup
- **IScmPlatform**: basic implementation -- `createPR()`, `mergePR()`, `getPR()`, `isAvailable()`, `getRepoInfo()`
- Agent platform uses all three (see [agent-platform.md](agent-platform.md))
- Diff service wired to UI via IPC
- Supervisor runs worktree cleanup

### Phase 3: Full SCM (Issues)

- `IScmPlatform.listIssues()` and `getIssue()` implemented
- GitHub issues import feature: browse issues in-app, convert to tasks with one click
- `IScmPlatform.listPRs()` implemented for dashboard views

### Future

- **GitLab**: `GitLabPlatform` implementing `IScmPlatform` -- uses `glab` CLI or GitLab API
- **Bitbucket**: `BitbucketPlatform` implementing `IScmPlatform`
- **libgit2**: `LibGit2Ops` implementing `IGitOps` -- native bindings for performance (no `child_process` overhead)
- **Remote workspaces**: `IWorktreeManager` could manage cloud dev environments instead of local directories

---

## Cross-References

- **[agent-platform.md](agent-platform.md)** -- uses `IWorktreeManager` to create isolated environments, `IGitOps` for branch/commit operations, and `IScmPlatform` for PR creation. The full 10-step agent execution pipeline depends on all three.
- **[overview.md](overview.md)** -- defines all three interfaces (`IGitOps`, `IWorktreeManager`, `IScmPlatform`) with full type signatures. Shows how they fit in the composition root and dependency injection graph.
- **[workflow-service.md](workflow-service.md)** -- the `WorkflowService.mergePR()` method orchestrates PR merge through `IScmPlatform`, artifact updates through `ITaskStore`, and pipeline transitions through `IPipelineEngine`. All PR merges must go through the WorkflowService.
