# Testing

## Running Tests

```bash
npx vitest run          # Run all tests once
npx vitest run tests/e2e/pipeline-auto-transition.test.ts  # Run a single file
npx vitest              # Watch mode
```

- **Framework:** Vitest (node environment)
- **Test files:** `tests/**/*.test.ts`
- **157 tests** across 23 test files (~750ms total)

## Directory Layout

```
tests/
├── helpers/
│   ├── test-context.ts    # TestContext: full in-memory service graph
│   └── factories.ts       # Factory functions for creating test data
├── e2e/                   # End-to-end tests (21 files)
│   ├── pipeline-*.test.ts # Pipeline state machine, transitions, auto-transitions
│   ├── guard-*.test.ts    # Guard validation (has_pr, dependencies_resolved, etc.)
│   ├── agent-*.test.ts    # Agent lifecycle, output streaming, definitions
│   ├── task-*.test.ts     # Task CRUD, dependencies, context
│   ├── prompt-*.test.ts   # Human-in-the-loop prompt/response flow
│   ├── workflow-*.test.ts # WorkflowService lifecycle, dashboard stats
│   ├── event-*.test.ts    # Event logging, activity log
│   └── ...
├── cli/
│   └── cli-integration.test.ts  # CLI commands, output formatting
└── unit/
    └── claude-code-agent-output.test.ts  # Agent output parsing
```

## TestContext (`tests/helpers/test-context.ts`)

`createTestContext()` builds a complete, isolated service graph using an **in-memory SQLite database**. It mirrors the production composition root (`createAppServices`) but substitutes stubs for external dependencies (git, SCM, worktrees).

### What it provides

```ts
const ctx = createTestContext();

// Stores (real SQLite implementations, in-memory DB)
ctx.projectStore       ctx.pipelineStore      ctx.taskStore
ctx.taskEventLog       ctx.activityLog        ctx.agentRunStore
ctx.taskArtifactStore  ctx.taskPhaseStore     ctx.pendingPromptStore
ctx.featureStore       ctx.agentDefinitionStore  ctx.taskContextStore

// Services
ctx.pipelineEngine     // State machine with production guards registered
ctx.agentService       // Agent execution (uses ScriptedAgent by default)
ctx.workflowService    // High-level orchestration

// Agent control
ctx.scriptedAgent      // Set scripts to control agent behavior
ctx.agentFramework     // Register additional agents

// Stubs (verify interactions without real git/SCM)
ctx.worktreeManager    ctx.gitOps    ctx.scmPlatform    ctx.notificationRouter

// Helpers
ctx.transitionTo(taskId, toStatus)  // Safe manual transition (throws on failure)
ctx.db                              // Raw SQLite handle for direct queries
ctx.cleanup()                       // Close DB — call in afterEach
```

### Production parity

TestContext registers the same guards and hooks as production:

- **Guards:** `registerCoreGuards()` — `has_pr`, `dependencies_resolved`, `no_running_agent`, `max_retries`
- **Hooks:** `registerScmHandler()`, `registerPromptHandler()`, `registerNotificationHandler()`
- **Pipelines:** All `SEEDED_PIPELINES` are inserted (Simple, Feature, Bug, Agent, Investigation)

The in-memory DB has the full schema including all tables, indexes, and seed data.

### Cleanup

Always close the database in `afterEach`:

```ts
afterEach(() => {
  ctx.cleanup();
});
```

## Factory Functions (`tests/helpers/factories.ts`)

Factories generate valid test data with auto-incrementing names:

```ts
import { createProjectInput, createTaskInput, resetCounters } from '../helpers/factories';

resetCounters();  // Call in beforeEach to get deterministic names

const projectInput = createProjectInput();             // { name: 'Test Project 1', ... }
const taskInput = createTaskInput(projectId, pipelineId);  // { title: 'Test Task 1', ... }
const taskInput = createTaskInput(projectId, pipelineId, { assignee: 'alice' });  // with overrides
```

Available factories: `createProjectInput`, `createTaskInput`, `createAgentRunInput`, `createFeatureInput`, `createAgentDefinitionInput`, `createTaskContextInput`.

## The `transitionTo()` Helper

Use `ctx.transitionTo(taskId, toStatus)` for manual transitions. It:

1. Fetches the task by ID
2. Calls `pipelineEngine.executeTransition()` with `{ trigger: 'manual' }`
3. Throws a descriptive error on failure (includes guard names and reasons)
4. Returns the updated `Task` on success

```ts
// Good — uses helper, trigger is always correct
await ctx.transitionTo(taskId, 'planning');

// Also good — when you need the returned task
const task = await ctx.transitionTo(taskId, 'implementing');
expect(task.status).toBe('implementing');

// Testing that a transition is blocked by a guard
await expect(ctx.transitionTo(taskId, 'planning')).rejects.toThrow('no_running_agent');
```

### When NOT to use `transitionTo()`

Use `pipelineEngine.executeTransition()` directly when:

- **Testing agent-triggered transitions** (`trigger: 'agent'`) — the helper always uses `trigger: 'manual'`
- **Inspecting the full TransitionResult** — guard failure details, hook failures, etc.
- **Chaining on result.task** — when you need the result object, not just the task

## ScriptedAgent

Tests use `ScriptedAgent` to control agent behavior without running real agents. Pre-built scripts cover common outcomes:

```ts
import { happyPlan, happyImplement, happyReview, humanInTheLoop, failAfterSteps } from '../../src/main/agents/scripted-agent';

ctx.scriptedAgent.setScript(happyPlan);       // outcome: 'plan_complete'
ctx.scriptedAgent.setScript(happyImplement);   // outcome: 'pr_ready'
ctx.scriptedAgent.setScript(happyReview);      // outcome: 'approved'
ctx.scriptedAgent.setScript(humanInTheLoop);   // outcome: 'needs_info'
ctx.scriptedAgent.setScript(failAfterSteps(3)); // fails on 3rd call

// Custom inline script
ctx.scriptedAgent.setScript(async () => ({
  exitCode: 0,
  output: 'Custom result',
  outcome: 'my_outcome',
}));
```

After calling `agentService.execute()`, always wait for completion:

```ts
const run = await ctx.agentService.execute(taskId, 'plan', 'scripted');
await ctx.agentService.waitForCompletion(run.id);
```

## Best Practices

### Test structure

Every test file follows the same pattern:

```ts
describe('Feature Name', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    resetCounters();
    ctx = createTestContext();
    // ... create project, task, etc.
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('should do something', async () => {
    // arrange, act, assert
  });
});
```

### Use the right pipeline

Different pipelines have different statuses, transitions, and guards:

| Pipeline | ID | Use for |
|----------|----|---------|
| Simple | `pipeline-simple` | Basic open/in_progress/done flows |
| Feature | `pipeline-feature` | PR review flows, `has_pr` guard |
| Agent | `pipeline-agent` | Agent workflows: planning, implementing, `no_running_agent` and `max_retries` guards |
| Bug | `pipeline-bug` | Bug investigation flows |
| Investigation | `pipeline-investigation` | Investigation workflows |

Import pipeline constants from `src/main/data/seeded-pipelines`:

```ts
import { SIMPLE_PIPELINE, AGENT_PIPELINE, FEATURE_PIPELINE } from '../../src/main/data/seeded-pipelines';

const task = await ctx.taskStore.createTask(createTaskInput(projectId, AGENT_PIPELINE.id));
```

### Avoid hardcoded counts

Reference source-of-truth constants instead of magic numbers:

```ts
// Bad — breaks when a pipeline is added
expect(pipelines.length).toBe(5);

// Good — stays correct automatically
import { SEEDED_PIPELINES } from '../../src/main/data/seeded-pipelines';
expect(pipelines.length).toBe(SEEDED_PIPELINES.length);
```

### Use `transitionTo()` for manual transitions

Don't repeat the `getTask + executeTransition + assert success` boilerplate:

```ts
// Bad — verbose, trigger mismatch risk
const task = await ctx.taskStore.getTask(taskId);
const result = await ctx.pipelineEngine.executeTransition(task!, 'planning', { trigger: 'manual' });
expect(result.success).toBe(true);

// Good — one line, trigger is always correct
await ctx.transitionTo(taskId, 'planning');
```

### Use WorkflowService for high-level operations

When testing end-to-end flows, prefer `workflowService` methods which log activity and handle side effects:

```ts
// Creates task + logs activity
const task = await ctx.workflowService.createTask(createTaskInput(projectId, pipelineId));

// Transitions + logs activity + notifies
await ctx.workflowService.transitionTask(task.id, 'in_progress');

// Starts agent with proper worktree setup
const run = await ctx.workflowService.startAgent(task.id, 'plan', 'scripted');
```

### Direct store access for focused tests

For testing a specific store or guard, bypass WorkflowService and use stores directly:

```ts
const task = await ctx.taskStore.createTask(createTaskInput(projectId, pipelineId));
await ctx.taskStore.addDependency(task.id, depTask.id);
```

### Raw DB for verification

Use `ctx.db` to query transition history or other data not exposed through store interfaces:

```ts
const rows = ctx.db.prepare(
  "SELECT * FROM transition_history WHERE task_id = ? AND trigger = 'agent'"
).all(taskId);
```
