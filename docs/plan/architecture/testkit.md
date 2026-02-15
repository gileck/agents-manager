# E2E Testing & TestKit

The testing infrastructure for Agents Manager. A built-in testkit that provides mock implementations for all external dependencies, scripted agents, and helper utilities for writing fast, deterministic end-to-end tests.

See also: [overview.md](overview.md) | [workflow-service.md](workflow-service.md) | [agent-platform.md](agent-platform.md) | [tasks.md](tasks.md)

---

## Philosophy

The interface-first architecture means every external dependency has an interface. The testkit provides test implementations for each one:

- **Real SQLite in `:memory:`** — same code as production, same SQL, same migrations. Just no disk I/O. Wiped per test.
- **Mock git/GitHub** — no real git repos, no network calls. Operations are recorded in memory for assertions.
- **Scripted agents** — predetermined steps instead of LLM calls. Fast, deterministic, configurable per test.
- **Real business logic** — `WorkflowService`, `PipelineEngine`, event logging, artifact management all run the real code.

This tests the actual system behavior, not a simulation of it. The only things mocked are external side effects (git, GitHub, LLM, filesystem, notifications).

---

## Test Layers

| Layer | What It Tests | Dependencies | Speed |
|-------|--------------|-------------|-------|
| **Unit** | Individual service methods in isolation | In-memory SQLite, no agents | < 1ms per test |
| **Integration** | WorkflowService orchestration, pipeline transitions | In-memory SQLite + ScriptedAgent | < 10ms per test |
| **E2E** | Full workflow scenarios through CLI or WorkflowService | Full TestContext (all mocks) | < 50ms per test |

The testkit is primarily designed for E2E tests, but its components can be used at any layer.

---

## TestContext

The single entry point for all E2E tests. Creates and wires all mock implementations, applies migrations, seeds default data.

```typescript
// src/test/testkit/context.ts

interface TestContext {
  // ─── Services ──────────────────────────────────────────────────
  /** The real WorkflowService, wired with test implementations. */
  workflow: IWorkflowService;

  /** Direct access to the pipeline engine for low-level assertions. */
  pipeline: IPipelineEngine;

  // ─── Quick Accessors ──────────────────────────────────────────
  /** Fetch a task by ID directly from the in-memory DB. */
  task(id: string): Promise<Task>;

  /** Fetch all phases for a task, ordered by sortOrder. */
  phases(taskId: string): Promise<TaskPhase[]>;

  /** Fetch artifacts with optional filters. */
  artifacts(taskId: string, filter?: ArtifactFilter): Promise<TaskArtifact[]>;

  /** Fetch event log entries for a task. */
  events(taskId: string): Promise<TaskEvent[]>;

  /** Fetch all agent runs for a task. */
  runs(taskId: string): Promise<AgentRun[]>;

  // ─── Mock State ────────────────────────────────────────────────
  /** Inspect recorded git operations. */
  git: MockGitState;

  /** Inspect recorded SCM/GitHub operations. */
  scm: MockScmState;

  /** Inspect captured notifications. */
  notifications: MockNotification[];

  // ─── Agent Configuration ───────────────────────────────────────
  /** Configure scripted agent behavior for upcoming runs. */
  agents: AgentConfigurator;

  // ─── Lifecycle ─────────────────────────────────────────────────
  /** Tear down: close DB, reset all mocks. Call in afterEach. */
  cleanup(): Promise<void>;
}

interface ArtifactFilter {
  type?: string;                 // 'branch', 'pull_request', 'document', etc.
  phase?: number;                // phase index (0-based) — convenience for sortOrder
  phaseId?: string | null;       // explicit phaseId, null for task-level artifacts
}
```

### Creating a TestContext

```typescript
import { createTestContext } from '../testkit';

describe('task workflow', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    // At this point:
    // - In-memory SQLite DB is created with all migrations applied
    // - 'simple' pipeline is seeded
    // - All mock implementations are wired into WorkflowService
    // - ScriptedAgent is registered as the default agent
  });

  afterEach(async () => {
    await ctx.cleanup();
  });
});
```

### TestContext Options

```typescript
interface TestContextOptions {
  /** Additional pipelines to seed beyond 'simple'. */
  pipelines?: PipelineDefinition[];

  /** Project config to use (merged with defaults). */
  projectConfig?: Partial<ProjectConfig>;

  /** Whether to auto-create a default project. Default: true. */
  createDefaultProject?: boolean;

  /** Default agent scripts to preload. */
  agentScripts?: Record<string, AgentScript>;
}

// Example: test with a custom pipeline
const ctx = await createTestContext({
  pipelines: [BuiltInPipelines.feature],
  projectConfig: {
    defaultAgentType: 'claude-code',
    checks: { build: 'npm run build', test: 'npm test' },
  },
});
```

---

## Mock Implementations

### In-Memory SQLite

The real `SqliteTaskStore`, `SqliteProjectStore`, and all other SQLite-backed stores — initialized with `:memory:` instead of a file path. All migrations run on creation.

```typescript
// src/test/testkit/db.ts

function createTestDatabase(): Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Apply all migrations (same migration list as production)
  applyMigrations(db, allMigrations);

  // Seed default data
  seedSimplePipeline(db);

  return db;
}
```

**Why real SQLite, not a mock?** The DB layer has real SQL queries, JSON column parsing, index usage, foreign key cascades, and transaction logic. Mocking this would miss bugs. In-memory SQLite is fast enough (< 1ms per query) and tests the actual code.

### MockGitOps

Records all git operations in memory. No real git commands are executed.

```typescript
// src/test/testkit/mock-git.ts

interface MockGitState {
  /** All branches that have been created. */
  branches: string[];

  /** All commits made, with branch and message. */
  commits: { branch: string; message: string; hash: string }[];

  /** All push operations recorded. */
  pushes: { branch: string; remote: string }[];

  /** All checkouts recorded. */
  checkouts: string[];

  /** Reset all recorded state. */
  reset(): void;
}

class MockGitOps implements IGitOps {
  readonly state: MockGitState = { branches: [], commits: [], pushes: [], checkouts: [], reset() { /* ... */ } };

  // Pre-configured responses
  private statusResponse: GitStatus = { staged: [], unstaged: [], untracked: [] };
  private diffResponse: FileDiff[] = [];

  async createBranch(repoPath: string, branchName: string, baseBranch: string): Promise<void> {
    this.state.branches.push(branchName);
  }

  async commit(repoPath: string, message: string): Promise<string> {
    const hash = randomId(8);
    const branch = this.state.checkouts.at(-1) || 'main';
    this.state.commits.push({ branch, message, hash });
    return hash;
  }

  async push(repoPath: string, branchName: string, remote: string): Promise<void> {
    this.state.pushes.push({ branch: branchName, remote });
  }

  async getStatus(repoPath: string): Promise<GitStatus> {
    return this.statusResponse;
  }

  async getDiff(repoPath: string, opts: DiffOptions): Promise<FileDiff[]> {
    return this.diffResponse;
  }

  // Test helpers
  setStatus(status: GitStatus): void { this.statusResponse = status; }
  setDiff(diff: FileDiff[]): void { this.diffResponse = diff; }
}
```

### MockWorktreeManager

Tracks worktrees in a `Map`. No filesystem operations.

```typescript
// src/test/testkit/mock-worktree.ts

interface MockWorktree {
  taskId: string;
  phaseId?: string;
  branchName: string;
  path: string;        // fake path
  locked: boolean;
}

class MockWorktreeManager implements IWorktreeManager {
  readonly worktrees = new Map<string, MockWorktree>();

  async create(opts: CreateWorktreeOptions): Promise<Worktree> {
    const id = opts.phaseId || opts.taskId;
    const fakePath = `/tmp/mock-worktrees/${id}`;
    const wt: MockWorktree = {
      taskId: opts.taskId,
      phaseId: opts.phaseId,
      branchName: opts.branchName,
      path: fakePath,
      locked: true,
    };
    this.worktrees.set(id, wt);
    return { path: fakePath, branch: opts.branchName, locked: true };
  }

  async delete(taskId: string): Promise<void> {
    this.worktrees.delete(taskId);
  }

  async cleanup(): Promise<CleanupReport> {
    const stale = [...this.worktrees.values()].filter(w => !w.locked);
    for (const w of stale) this.worktrees.delete(w.taskId);
    return { removed: stale.length, errors: [] };
  }
}
```

### MockScmPlatform

In-memory PR store. Simulates GitHub without network calls.

```typescript
// src/test/testkit/mock-scm.ts

interface MockPR {
  prNumber: number;
  title: string;
  headBranch: string;
  baseBranch: string;
  state: 'open' | 'merged' | 'closed';
  body?: string;
  draft?: boolean;
  createdAt: string;
  mergedAt?: string;
}

interface MockScmState {
  /** All PRs created, in order. */
  prs: MockPR[];

  /** All merge operations recorded. */
  merges: { prNumber: number; mergedAt: string }[];

  /** Reset all recorded state. */
  reset(): void;
}

class MockScmPlatform implements IScmPlatform {
  readonly state: MockScmState;
  private nextPrNumber = 1;

  async createPR(opts: CreatePROptions): Promise<PullRequest> {
    const pr: MockPR = {
      prNumber: this.nextPrNumber++,
      title: opts.title,
      headBranch: opts.headBranch,
      baseBranch: opts.baseBranch,
      state: 'open',
      body: opts.body,
      draft: opts.draft,
      createdAt: new Date().toISOString(),
    };
    this.state.prs.push(pr);
    return {
      number: pr.prNumber,
      title: pr.title,
      url: `https://github.com/test/repo/pull/${pr.prNumber}`,
      state: 'open',
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
    };
  }

  async mergePR(repoUrl: string, prNumber: number): Promise<void> {
    const pr = this.state.prs.find(p => p.prNumber === prNumber);
    if (!pr) throw new Error(`PR #${prNumber} not found`);
    if (pr.state !== 'open') throw new Error(`PR #${prNumber} is not open`);
    pr.state = 'merged';
    pr.mergedAt = new Date().toISOString();
    this.state.merges.push({ prNumber, mergedAt: pr.mergedAt });
  }

  async getPR(repoUrl: string, prNumber: number): Promise<PullRequest | null> {
    const pr = this.state.prs.find(p => p.prNumber === prNumber);
    if (!pr) return null;
    return {
      number: pr.prNumber,
      title: pr.title,
      url: `https://github.com/test/repo/pull/${pr.prNumber}`,
      state: pr.state,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
    };
  }

  async isAvailable(): Promise<boolean> { return true; }

  async getRepoInfo(projectPath: string): Promise<RepoInfo> {
    return {
      url: 'https://github.com/test/repo',
      owner: 'test',
      name: 'repo',
      defaultBranch: 'main',
    };
  }
}
```

### MockNotifier

Captures all notifications in an array.

```typescript
// src/test/testkit/mock-notifier.ts

interface MockNotification {
  type: string;
  title: string;
  body?: string;
  taskId?: string;
  timestamp: string;
}

class MockNotifier implements INotifier {
  readonly sent: MockNotification[] = [];

  async notify(opts: NotifyOptions): Promise<void> {
    this.sent.push({
      type: opts.type,
      title: opts.title,
      body: opts.body,
      taskId: opts.taskId,
      timestamp: new Date().toISOString(),
    });
  }

  reset(): void { this.sent.length = 0; }
}
```

---

## ScriptedAgent

A fake `IAgent` implementation that executes a predetermined sequence of steps instead of calling an LLM. Simulates realistic agent behavior — streaming output, creating files, making commits, producing outcomes.

### AgentScript

```typescript
// src/test/testkit/scripted-agent.ts

interface AgentScript {
  steps: AgentStep[];
}

type AgentStep =
  | { type: 'output'; text: string; delay?: number }
  | { type: 'createFile'; path: string; content: string }
  | { type: 'modifyFile'; path: string; diff: string }
  | { type: 'deleteFile'; path: string }
  | { type: 'commit'; message: string }
  | { type: 'createPR'; title?: string }
  | { type: 'createDocument'; label: string; docType: string; content: string }
  | { type: 'createMock'; label: string; format: 'html' | 'image'; filePath: string }
  | { type: 'outcome'; value: string; payload?: Record<string, any> }
  | { type: 'error'; message: string }
  | { type: 'askHuman'; question: string; options?: string[] }
  | { type: 'delay'; ms: number };
```

### ScriptedAgent Implementation

```typescript
class ScriptedAgent implements IAgent {
  readonly type = 'scripted';
  readonly displayName = 'Scripted Agent (Test)';

  private scripts = new Map<string, AgentScript>();  // keyed by mode

  setScript(mode: string, script: AgentScript): void {
    this.scripts.set(mode, script);
  }

  async run(opts: AgentRunOptions): Promise<AgentOutcome> {
    const script = this.scripts.get(opts.mode);
    if (!script) throw new Error(`No script configured for mode: ${opts.mode}`);

    for (const step of script.steps) {
      switch (step.type) {
        case 'output':
          if (step.delay) await sleep(step.delay);
          opts.onOutput?.(step.text);
          break;

        case 'createFile':
          // Record via MockGitOps — the agent platform picks this up
          opts.onFileChange?.({ type: 'create', path: step.path, content: step.content });
          break;

        case 'commit':
          opts.onCommit?.(step.message);
          break;

        case 'createPR':
          opts.onCreatePR?.(step.title || `PR for ${opts.taskTitle}`);
          break;

        case 'createDocument':
          opts.onArtifact?.({
            type: 'document',
            label: step.label,
            content: step.content,
            metadata: { docType: step.docType },
          });
          break;

        case 'createMock':
          opts.onArtifact?.({
            type: 'mock',
            label: step.label,
            filePath: step.filePath,
            metadata: { format: step.format },
          });
          break;

        case 'outcome':
          return { value: step.value, payload: step.payload };

        case 'error':
          throw new AgentError(step.message);

        case 'askHuman':
          opts.onHumanInput?.(step.question, step.options);
          // Pauses until response is provided via the pending prompt system
          break;

        case 'delay':
          await sleep(step.ms);
          break;
      }
    }

    // If no explicit outcome step, default to completed
    return { value: 'completed', payload: {} };
  }
}
```

### AgentConfigurator

The test-facing API for configuring agent behavior. Part of `TestContext`.

```typescript
interface AgentConfigurator {
  /** Set script for the next agent run in this mode. */
  script(mode: string, script: AgentScript): void;

  /** Make the next agent run in this mode fail with an error. */
  fail(mode: string, error: string): void;

  /** Make the next agent run in this mode timeout (never complete). */
  timeout(mode: string): void;

  /** Make the next agent run pause for human input. */
  askHuman(mode: string, question: string, resumeScript?: AgentScript): void;

  /** Queue multiple scripts — first call uses first script, second call uses second, etc. */
  queue(mode: string, scripts: AgentScript[]): void;
}
```

### Built-In Agent Scripts

Pre-built scripts for common scenarios. Each returns an `AgentScript`.

```typescript
// src/test/testkit/agent-scripts.ts

const AgentScripts = {
  /**
   * Plan agent that produces a plan and a technical design document.
   */
  happyPlan: (opts?: {
    plan?: string;
    designDoc?: string;
  }): AgentScript => ({
    steps: [
      { type: 'output', text: 'Analyzing task requirements...', delay: 10 },
      { type: 'output', text: 'Reading codebase...', delay: 10 },
      { type: 'createDocument', label: 'Technical Design', docType: 'technical_design',
        content: opts?.designDoc || '## Design\n\nDefault technical design content.' },
      { type: 'outcome', value: 'plan_ready', payload: {
        plan: opts?.plan || '## Implementation Plan\n\n1. Step one\n2. Step two\n3. Step three',
      }},
    ],
  }),

  /**
   * Implement agent that creates files, commits, and a PR.
   */
  happyImplement: (opts?: {
    files?: { path: string; content: string }[];
    commits?: { message: string }[];
  }): AgentScript => ({
    steps: [
      { type: 'output', text: 'Starting implementation...', delay: 10 },
      // Create files
      ...(opts?.files || [{ path: 'src/feature.ts', content: 'export function feature() {}' }])
        .map(f => ({ type: 'createFile' as const, path: f.path, content: f.content })),
      // Make commits
      ...(opts?.commits || [{ message: 'Implement feature' }])
        .map(c => ({ type: 'commit' as const, message: c.message })),
      { type: 'createPR' },
      { type: 'outcome', value: 'pr_ready' },
    ],
  }),

  /**
   * Review agent that approves or requests changes.
   */
  happyReview: (opts?: {
    approved?: boolean;
    comments?: string[];
  }): AgentScript => ({
    steps: [
      { type: 'output', text: 'Reviewing changes...', delay: 10 },
      { type: 'outcome', value: opts?.approved !== false ? 'approved' : 'changes_requested',
        payload: { comments: opts?.comments || [] }},
    ],
  }),

  /**
   * Agent that fails after N steps.
   */
  failAfterSteps: (n: number, error: string): AgentScript => ({
    steps: [
      ...Array.from({ length: n }, (_, i) => ({
        type: 'output' as const, text: `Step ${i + 1}...`, delay: 5,
      })),
      { type: 'error', message: error },
    ],
  }),

  /**
   * Agent that asks a human question mid-run.
   */
  humanInTheLoop: (question: string, resumeSteps: AgentStep[]): AgentScript => ({
    steps: [
      { type: 'output', text: 'Working...', delay: 10 },
      { type: 'askHuman', question },
      // After human responds, continue with these steps
      ...resumeSteps,
    ],
  }),

  /**
   * Agent that produces nothing (empty run).
   */
  noop: (): AgentScript => ({
    steps: [
      { type: 'outcome', value: 'completed' },
    ],
  }),
};
```

---

## Assertion Helpers

Utility functions for common assertions. These make tests more readable and provide better error messages.

```typescript
// src/test/testkit/assertions.ts

const expect = {
  /**
   * Assert task is in a specific status.
   */
  taskStatus: async (ctx: TestContext, taskId: string, expected: string) => {
    const task = await ctx.task(taskId);
    assert.equal(task.status, expected, `Expected task ${taskId} to be "${expected}" but was "${task.status}"`);
  },

  /**
   * Assert task has a plan containing specific text.
   */
  taskHasPlan: async (ctx: TestContext, taskId: string, containing?: string) => {
    const task = await ctx.task(taskId);
    assert.ok(task.plan, `Expected task ${taskId} to have a plan`);
    if (containing) {
      assert.ok(task.plan.includes(containing), `Expected plan to contain "${containing}"`);
    }
  },

  /**
   * Assert a specific number of artifacts of a type exist.
   */
  artifactCount: async (ctx: TestContext, taskId: string, type: string, expected: number) => {
    const artifacts = await ctx.artifacts(taskId, { type });
    assert.equal(artifacts.length, expected,
      `Expected ${expected} "${type}" artifacts but found ${artifacts.length}`);
  },

  /**
   * Assert phase statuses match expected array.
   */
  phaseStatuses: async (ctx: TestContext, taskId: string, expected: string[]) => {
    const phases = await ctx.phases(taskId);
    const actual = phases.map(p => p.status);
    assert.deepEqual(actual, expected,
      `Expected phase statuses ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  },

  /**
   * Assert event log contains events of specific types in order.
   */
  eventTypes: async (ctx: TestContext, taskId: string, expected: string[]) => {
    const events = await ctx.events(taskId);
    const actual = events.map(e => e.type);
    assert.deepEqual(actual, expected,
      `Expected event types ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  },

  /**
   * Assert a branch was created.
   */
  branchCreated: (ctx: TestContext, branchPattern: string | RegExp) => {
    const match = typeof branchPattern === 'string'
      ? ctx.git.branches.some(b => b.includes(branchPattern))
      : ctx.git.branches.some(b => branchPattern.test(b));
    assert.ok(match, `Expected a branch matching "${branchPattern}" but found: ${ctx.git.branches.join(', ')}`);
  },

  /**
   * Assert a PR was created with specific properties.
   */
  prCreated: (ctx: TestContext, filter: Partial<MockPR>) => {
    const match = ctx.scm.prs.find(pr =>
      Object.entries(filter).every(([k, v]) => (pr as any)[k] === v)
    );
    assert.ok(match, `Expected a PR matching ${JSON.stringify(filter)}`);
  },

  /**
   * Assert a notification was sent.
   */
  notificationSent: (ctx: TestContext, type: string) => {
    const match = ctx.notifications.some(n => n.type === type);
    assert.ok(match, `Expected notification of type "${type}" but none was sent`);
  },
};
```

---

## Example Tests

### Single-phase: plan → implement → merge

```typescript
describe('single-phase workflow', () => {
  let ctx: TestContext;

  beforeEach(async () => { ctx = await createTestContext(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('plan → implement → PR → merge → done', async () => {
    const project = await ctx.workflow.createProject({ name: 'my-app', path: '/fake/my-app' });
    const task = await ctx.workflow.createTask({ projectId: project.id, title: 'Add login page' });

    // Plan
    ctx.agents.script('plan', AgentScripts.happyPlan({
      plan: '## Steps\n1. Create LoginPage component\n2. Add route\n3. Connect to auth API',
    }));
    await ctx.workflow.transitionTask(task.id, 'planning');

    await expect.taskStatus(ctx, task.id, 'planned');
    await expect.taskHasPlan(ctx, task.id, 'LoginPage component');
    await expect.artifactCount(ctx, task.id, 'document', 1);

    // Implement
    ctx.agents.script('implement', AgentScripts.happyImplement({
      files: [
        { path: 'src/pages/Login.tsx', content: 'export function LoginPage() { return <div>Login</div>; }' },
        { path: 'src/routes.ts', content: 'export const routes = [{ path: "/login", component: LoginPage }];' },
      ],
      commits: [
        { message: 'Add LoginPage component' },
        { message: 'Add login route' },
      ],
    }));
    await ctx.workflow.transitionTask(task.id, 'in_progress');

    await expect.taskStatus(ctx, task.id, 'pr_review');
    await expect.artifactCount(ctx, task.id, 'branch', 1);
    await expect.artifactCount(ctx, task.id, 'pull_request', 1);
    expect.branchCreated(ctx, 'add-login-page');
    expect.prCreated(ctx, { baseBranch: 'main', state: 'open' });

    // Merge
    await ctx.workflow.mergePR(task.id);

    await expect.taskStatus(ctx, task.id, 'done');
    expect.prCreated(ctx, { state: 'merged' });
  });
});
```

### Multi-phase: backend → frontend → final PR

```typescript
describe('multi-phase workflow', () => {
  let ctx: TestContext;

  beforeEach(async () => { ctx = await createTestContext(); });
  afterEach(async () => { await ctx.cleanup(); });

  it('phase 1 → phase 2 → final PR → done', async () => {
    const project = await ctx.workflow.createProject({ name: 'my-app', path: '/fake/my-app' });
    const task = await ctx.workflow.createTask({ projectId: project.id, title: 'Add authentication' });

    // Add phases
    await ctx.workflow.createPhase({ taskId: task.id, name: 'Backend API' });
    await ctx.workflow.createPhase({ taskId: task.id, name: 'Frontend UI' });

    // Plan
    ctx.agents.script('plan', AgentScripts.happyPlan());
    await ctx.workflow.transitionTask(task.id, 'planning');
    await expect.taskStatus(ctx, task.id, 'planned');

    // Implement — agent scripts queued for both phases
    ctx.agents.queue('implement', [
      AgentScripts.happyImplement({
        files: [{ path: 'src/api/auth.ts', content: 'export function authMiddleware() {}' }],
        commits: [{ message: 'Add auth API' }],
      }),
      AgentScripts.happyImplement({
        files: [{ path: 'src/pages/Login.tsx', content: 'export function LoginPage() {}' }],
        commits: [{ message: 'Add login page' }],
      }),
    ]);

    await ctx.workflow.transitionTask(task.id, 'in_progress');

    // Both phases should complete, final PR created
    await expect.phaseStatuses(ctx, task.id, ['completed', 'completed']);

    // Phase PRs merge into task branch
    expect.prCreated(ctx, { baseBranch: expect.stringContaining('add-authentication') as any, state: 'merged' });

    // Final PR targets main
    const finalPR = (await ctx.artifacts(task.id, { type: 'pull_request', phaseId: null }))
      .find(a => a.metadata.state === 'open');
    assert.ok(finalPR);
    assert.equal(finalPR.metadata.baseBranch, 'main');

    // Task is in pr_review waiting for final merge
    await expect.taskStatus(ctx, task.id, 'pr_review');

    // Merge final PR
    await ctx.workflow.mergePR(task.id);
    await expect.taskStatus(ctx, task.id, 'done');

    // Verify git state
    assert.ok(ctx.git.branches.length >= 3); // task branch + 2 phase branches
    assert.equal(ctx.scm.prs.length, 3);     // 2 phase PRs + 1 final PR
    assert.equal(ctx.scm.merges.length, 3);  // all merged
  });
});
```

### Agent failure and retry

```typescript
it('agent fails → task stays in_progress → retry succeeds', async () => {
  const project = await ctx.workflow.createProject({ name: 'my-app', path: '/fake/my-app' });
  const task = await ctx.workflow.createTask({ projectId: project.id, title: 'Fix bug' });

  // Skip planning, go straight to implement
  ctx.agents.script('implement', AgentScripts.failAfterSteps(2, 'Out of context window'));
  await ctx.workflow.transitionTask(task.id, 'in_progress');

  // Task stays in_progress, agent run recorded as failed
  await expect.taskStatus(ctx, task.id, 'in_progress');
  const runs = await ctx.runs(task.id);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[0].error, 'Out of context window');

  // Retry with a working script
  ctx.agents.script('implement', AgentScripts.happyImplement());
  await ctx.workflow.retryAgent(task.id);

  await expect.taskStatus(ctx, task.id, 'pr_review');
  const runsAfter = await ctx.runs(task.id);
  assert.equal(runsAfter.length, 2);
  assert.equal(runsAfter[1].status, 'completed');
});
```

### Human-in-the-loop

```typescript
it('agent pauses for human input → resumes after response', async () => {
  const project = await ctx.workflow.createProject({ name: 'my-app', path: '/fake/my-app' });
  const task = await ctx.workflow.createTask({ projectId: project.id, title: 'Refactor auth' });

  ctx.agents.script('implement', AgentScripts.humanInTheLoop(
    'Should I use JWT or session-based auth?',
    [
      { type: 'output', text: 'Using JWT as requested...' },
      { type: 'createFile', path: 'src/auth/jwt.ts', content: '// JWT implementation' },
      { type: 'commit', message: 'Implement JWT auth' },
      { type: 'createPR' },
      { type: 'outcome', value: 'pr_ready' },
    ],
  ));

  await ctx.workflow.transitionTask(task.id, 'in_progress');

  // Agent is paused, waiting for human input
  await expect.taskStatus(ctx, task.id, 'needs_info');
  expect.notificationSent(ctx, 'humanInputNeeded');

  // Respond to the prompt
  await ctx.workflow.respondToPrompt(task.id, { answer: 'Use JWT' });

  // Agent resumes and completes
  await expect.taskStatus(ctx, task.id, 'pr_review');
  await expect.artifactCount(ctx, task.id, 'pull_request', 1);
});
```

### Document artifacts passed between agents

```typescript
it('plan agent design doc is injected into implement agent context', async () => {
  const project = await ctx.workflow.createProject({ name: 'my-app', path: '/fake/my-app' });
  const task = await ctx.workflow.createTask({ projectId: project.id, title: 'Add search' });

  // Plan agent produces a design doc
  ctx.agents.script('plan', AgentScripts.happyPlan({
    plan: '## Steps\n1. Add search index\n2. Add search API\n3. Add search UI',
    designDoc: '## Search Architecture\n\nUse Lunr.js for client-side full-text search.',
  }));
  await ctx.workflow.transitionTask(task.id, 'planning');

  // Verify design doc artifact was created
  const docs = await ctx.artifacts(task.id, { type: 'document' });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].metadata.docType, 'technical_design');
  assert.ok(docs[0].content?.includes('Lunr.js'));

  // Implement agent — capture what context it receives
  let receivedContext = '';
  ctx.agents.script('implement', {
    steps: [
      { type: 'output', text: 'Implementing...' },
      { type: 'outcome', value: 'pr_ready' },
    ],
  });
  // Hook into context assembly to verify
  ctx.onAgentContextBuilt((context) => { receivedContext = context; });

  await ctx.workflow.transitionTask(task.id, 'in_progress');

  // The implement agent received the design doc in its context
  assert.ok(receivedContext.includes('Lunr.js'),
    'Expected implement agent context to include the design doc');
  assert.ok(receivedContext.includes('Search Architecture'),
    'Expected implement agent context to include design doc title');
});
```

---

## Composition Root (Test)

How the TestContext wires everything together:

```typescript
// src/test/testkit/context.ts

async function createTestContext(opts?: TestContextOptions): Promise<TestContext> {
  // 1. Create in-memory database
  const db = createTestDatabase();

  // 2. Create real store implementations with in-memory DB
  const taskStore = new SqliteTaskStore(db);
  const projectStore = new SqliteProjectStore(db);
  const pipelineStore = new SqlitePipelineStore(db);
  const eventLog = new SqliteEventLog(db);
  const activityLog = new SqliteActivityLog(db);
  const agentRunStore = new SqliteAgentRunStore(db);

  // 3. Create mock implementations for external dependencies
  const mockGit = new MockGitOps();
  const mockWorktree = new MockWorktreeManager();
  const mockScm = new MockScmPlatform();
  const mockNotifier = new MockNotifier();
  const scriptedAgent = new ScriptedAgent();

  // 4. Create real agent framework with scripted agent
  const agentFramework = new AgentFrameworkImpl();
  agentFramework.register(scriptedAgent);

  // 5. Create real pipeline engine
  const pipelineEngine = new PipelineEngine(pipelineStore, eventLog);

  // Register built-in handlers (these use the mock implementations)
  pipelineEngine.registerHandler(new AgentHandler(agentFramework, agentRunStore, mockWorktree, mockGit));
  pipelineEngine.registerHandler(new GitHandler(mockGit, mockScm, taskStore));
  pipelineEngine.registerHandler(new NotificationHandler(mockNotifier));

  // 6. Wire up the real WorkflowService
  const workflow = new WorkflowServiceImpl({
    taskStore,
    projectStore,
    pipelineEngine,
    eventLog,
    activityLog,
    agentRunStore,
    agentFramework,
    gitOps: mockGit,
    worktreeManager: mockWorktree,
    scmPlatform: mockScm,
    notifier: mockNotifier,
  });

  // 7. Optionally create a default project
  if (opts?.createDefaultProject !== false) {
    await workflow.createProject({ name: 'test-project', path: '/fake/test-project' });
  }

  // 8. Return TestContext
  return {
    workflow,
    pipeline: pipelineEngine,

    task: (id) => taskStore.getTask(id),
    phases: (taskId) => taskStore.listPhases(taskId),
    artifacts: (taskId, filter) => /* filter logic over taskStore.listArtifacts */,
    events: (taskId) => eventLog.list(taskId),
    runs: (taskId) => agentRunStore.list(taskId),

    git: mockGit.state,
    scm: mockScm.state,
    notifications: mockNotifier.sent,

    agents: {
      script: (mode, s) => scriptedAgent.setScript(mode, s),
      fail: (mode, err) => scriptedAgent.setScript(mode, AgentScripts.failAfterSteps(0, err)),
      timeout: (mode) => scriptedAgent.setScript(mode, { steps: [{ type: 'delay', ms: 999999 }] }),
      askHuman: (mode, q, resume) => scriptedAgent.setScript(mode,
        AgentScripts.humanInTheLoop(q, resume?.steps || [{ type: 'outcome', value: 'completed' }])),
      queue: (mode, scripts) => scriptedAgent.queueScripts(mode, scripts),
    },

    cleanup: async () => {
      db.close();
      mockGit.state.reset();
      mockScm.state.reset();
      mockNotifier.reset();
    },
  };
}
```

---

## File Structure

```
src/test/
├── testkit/
│   ├── index.ts                 # Re-exports createTestContext, AgentScripts, assertions
│   ├── context.ts               # TestContext creation and wiring
│   ├── db.ts                    # In-memory SQLite setup + migrations
│   ├── scripted-agent.ts        # ScriptedAgent + AgentScript types
│   ├── agent-scripts.ts         # Built-in AgentScripts (happyPlan, happyImplement, etc.)
│   ├── mock-git.ts              # MockGitOps
│   ├── mock-worktree.ts         # MockWorktreeManager
│   ├── mock-scm.ts              # MockScmPlatform
│   ├── mock-notifier.ts         # MockNotifier
│   └── assertions.ts            # Assertion helpers
├── e2e/
│   ├── single-phase.test.ts     # Single-phase task workflows
│   ├── multi-phase.test.ts      # Multi-phase task workflows
│   ├── agent-failure.test.ts    # Agent failure, retry, timeout
│   ├── human-in-the-loop.test.ts # Pause/resume, prompt responses
│   ├── artifacts.test.ts        # Artifact creation, context chain
│   ├── pipeline.test.ts         # Pipeline transitions, guards, hooks
│   └── notifications.test.ts    # Notification delivery
└── integration/
    ├── workflow-service.test.ts  # WorkflowService method tests
    ├── pipeline-engine.test.ts   # PipelineEngine with guards/hooks
    └── task-store.test.ts        # TaskStore CRUD, filters, queries
```

---

## CLI Test Runner

For tests that exercise the CLI layer (parsing, output formatting), the testkit provides a CLI test helper:

```typescript
// src/test/testkit/cli-runner.ts

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  json?: any;               // parsed if --json flag was used
}

/**
 * Run a CLI command against the test context.
 * Uses the same WorkflowService instance — no separate process.
 */
async function runCli(ctx: TestContext, command: string): Promise<CliResult> {
  // Parse command string into args
  // Route through the CLI command handlers
  // Capture stdout/stderr
  // Return structured result
}

// Usage in tests:
const result = await runCli(ctx, 'am tasks list --project test-project --json');
assert.equal(result.exitCode, 0);
assert.equal(result.json.length, 3);

const result2 = await runCli(ctx, 'am tasks get --id task-123 --json');
assert.equal(result2.json.status, 'done');
```

This tests the full stack: CLI argument parsing → WorkflowService → SQLite → response formatting. Without spawning a separate process.
