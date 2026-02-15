# Pipeline JSON Contract

Pipeline definitions are JSON configurations stored in the database. This document defines the data model, the full annotated JSON contract, handlers that provide behavior, and the built-in pipeline templates.

See also: [engine.md](engine.md) | [outcome-schemas.md](outcome-schemas.md) | [event-log.md](event-log.md) | [errors.md](errors.md) | [ui.md](ui.md)

---

## Data Model

### Pipeline Definition

```typescript
interface PipelineDefinition {
  id: string;                    // 'default', 'bug', 'feature', 'custom-123'
  name: string;                  // 'Default Pipeline'
  description?: string;
  isDefault: boolean;            // one pipeline is the default for new tasks

  statuses: PipelineStatus[];
  transitions: PipelineTransition[];

  initialStatus: string;         // status ID for newly created tasks
  terminalStatuses: string[];    // status IDs that mean "done" (done, cancelled, etc.)
}

interface PipelineStatus {
  id: string;                    // 'open', 'in_progress', 'pr_review', etc.
  label: string;                 // 'In Progress' (display name)
  description?: string;          // 'Task is being actively worked on'
  color: string;                 // '#3b82f6' (for UI badges and kanban columns)
  category: StatusCategory;      // for grouping (kanban columns, dashboard stats)
  position: number;              // display order (left-to-right in kanban)
}

type StatusCategory = 'backlog' | 'active' | 'review' | 'waiting' | 'done' | 'blocked';
// 'waiting' = pipeline is paused, waiting for human input (needs info, choose option, review comments)
```

### Transitions

```typescript
interface PipelineTransition {
  id: string;                    // unique ID for this transition
  from: string;                  // source status ID (or '*' for "from any status")
  to: string;                    // target status ID
  label: string;                 // 'Start Implementation', 'Request Changes'

  // Who can trigger this transition
  trigger: TransitionTrigger;

  // Optional: conditions that must be true for this transition
  guards?: TransitionGuard[];

  // Optional: actions to execute when this transition fires
  hooks?: TransitionHook[];
}

type TransitionTrigger =
  | { type: 'manual' }                              // user clicks a button
  | { type: 'agent_outcome'; outcome: string }      // agent completed successfully with a named outcome
                                                     //   e.g., "pr_ready", "needs_info", "options_proposed", "changes_requested"
                                                     //   outcome name maps to a payload schema in OUTCOME_SCHEMAS (outcome-schemas.ts)
  | { type: 'agent_error' }                          // agent process failed (crash, timeout, exception)
                                                     //   this is NOT "the agent decided something" — it means the process broke
  | { type: 'any' };                                 // either user or agent

// Guards are conditions checked BEFORE transition is allowed
interface TransitionGuard {
  type: string;          // guard type identifier
  params: Record<string, any>;
}

// Hooks are actions executed AFTER transition completes
interface TransitionHook {
  type: string;          // hook type identifier
  params: Record<string, any>;
}
```

---

## JSON Contract: What The Strings Point To

The pipeline JSON uses **string identifiers** to reference guards and hooks. These strings are resolved at runtime by the pipeline engine against the handler registries. Here's the exact contract:

### Annotated Example

A complete pipeline definition with every field explained:

```jsonc
{
  // ─── Pipeline Identity ───────────────────────────────────────────
  "id": "feature",                  // unique ID, used in task.pipelineId
  "name": "Feature",                // display name in UI dropdowns
  "description": "Full workflow with optional UX design and tech planning",
  "isDefault": false,               // only one pipeline can be default (used for new tasks with no explicit pipeline)

  // ─── State Machine Boundaries ────────────────────────────────────
  "initialStatus": "open",          // status ID assigned when a task is created with this pipeline
  "terminalStatuses": ["done", "cancelled"],  // status IDs that mean "task is finished" (no outgoing transitions)

  // ─── Statuses (nodes in the graph) ───────────────────────────────
  "statuses": [
    {
      "id": "open",                 // unique within this pipeline, stored in task.status
      "label": "Open",              // display name in UI (kanban column header, badges, etc.)
      "description": "Task is ready to be picked up",  // tooltip / detail text
      "color": "#6b7280",           // hex color for UI (kanban column, badges, graph nodes)
      "category": "backlog",        // groups statuses for kanban sections, dashboard stats, supervisor checks
                                    //   backlog = not started
                                    //   active  = work happening (agent running or human working)
                                    //   review  = waiting for review
                                    //   waiting = blocked on human input (needs info, pick option)
                                    //   done    = terminal
                                    //   blocked = stuck / failed
      "position": 0                 // display order: left-to-right in kanban, top-to-bottom in lists
    },
    { "id": "planning",       "label": "Tech Planning",  "color": "#8b5cf6", "category": "active",   "position": 1 },
    { "id": "planned",        "label": "Planned",        "color": "#a78bfa", "category": "backlog",  "position": 2 },
    { "id": "in_progress",    "label": "In Progress",    "color": "#3b82f6", "category": "active",   "position": 3 },
    { "id": "pr_review",      "label": "PR Review",      "color": "#f59e0b", "category": "review",   "position": 4 },
    { "id": "changes_requested", "label": "Changes Requested", "color": "#ef4444", "category": "active", "position": 5 },
    { "id": "done",           "label": "Done",           "color": "#22c55e", "category": "done",     "position": 6 },
    { "id": "failed",         "label": "Failed",         "color": "#dc2626", "category": "blocked",  "position": 7 },
    { "id": "cancelled",      "label": "Cancelled",      "color": "#9ca3af", "category": "done",     "position": 8 }
  ],

  // ─── Transitions (edges in the graph) ────────────────────────────
  "transitions": [

    // --- Admin picks the starting path ---
    {
      "id": "t1",                   // unique within this pipeline
      "from": "open",               // source status ID (must match a status.id above)
      "to": "planning",             // target status ID (must match a status.id above)
      "label": "Tech Plan",         // button text shown in UI

      "trigger": {
        "type": "any"               // who can trigger this transition:
                                    //   "manual"        = only a human (button click, CLI, Telegram action)
                                    //   "agent_outcome" = agent completed successfully with a named outcome
                                    //                     outcome: "plan_complete", "pr_ready", "needs_info", etc.
                                    //   "agent_error"   = agent process failed (crash, timeout, exception)
                                    //                     NOT a decision — the process itself broke
                                    //   "any"           = either human or agent
      },

      "hooks": [                    // actions executed AFTER transition completes (in order)
        {
          "type": "start_agent",    // ← string that maps to a function registered by AgentHandler
          "params": {               // ← arbitrary key-value pairs passed to the hook function
            "agentType": "claude-code",  // ← maps to IAgent.type (resolved via agentFramework.getAgent())
                                         //   if omitted, uses project's defaultAgentType
            "mode": "plan"               // ← determines prompt template: "plan", "implement", "review", "investigate", "design"
          }
        }
      ]
      // no "guards" on this transition — anyone can start planning at any time
    },

    // --- Skip planning, go straight to implementation ---
    {
      "id": "t2",
      "from": "open",
      "to": "in_progress",
      "label": "Skip to Implement",
      "trigger": { "type": "any" },
      "hooks": [
        { "type": "start_agent", "params": { "mode": "implement" } }
        // agentType omitted → uses project default
      ]
    },

    // --- Agent finishes planning successfully → task becomes "planned" ---
    {
      "id": "t3",
      "from": "planning",
      "to": "planned",
      "label": "Planning Complete",
      "trigger": {
        "type": "agent_outcome",
        "outcome": "plan_complete"   // fires when agent exits with this named outcome
      }
      // no hooks, no guards — just a status change
    },

    // --- Agent process crashes/times out during planning ---
    {
      "id": "t4",
      "from": "planning",
      "to": "failed",
      "label": "Planning Failed",
      "trigger": { "type": "agent_error" }   // actual process failure (crash, timeout)
    },

    // --- Admin approves plan, starts implementation ---
    {
      "id": "t5",
      "from": "planned",
      "to": "in_progress",
      "label": "Implement",
      "trigger": { "type": "any" },
      "hooks": [
        { "type": "start_agent", "params": { "mode": "implement" } }
      ]
    },

    // --- Implementation agent finishes with PR ready → auto-start PR review ---
    {
      "id": "t6",
      "from": "in_progress",
      "to": "pr_review",
      "label": "Ready for Review",
      "trigger": { "type": "agent_outcome", "outcome": "pr_ready" },
      "hooks": [
        { "type": "start_pr_review" }
        // shorthand — internally calls start_agent with mode: "review"
      ]
    },

    // --- Admin merges the PR and completes the task ---
    {
      "id": "t7",
      "from": "pr_review",
      "to": "done",
      "label": "Merge & Complete",
      "trigger": { "type": "manual" },  // only human can merge

      "guards": [                   // conditions checked BEFORE transition is allowed
        {
          "type": "has_pr",         // ← string that maps to a function registered by PrReviewHandler
          "params": {}              // ← this guard takes no params
        }
        // if guard returns false → transition blocked, button disabled with tooltip
      ],

      "hooks": [
        { "type": "merge_pr" },     // calls scmPlatform.mergePR(), updates PR artifact to "merged"
        { "type": "notify", "params": { "title": "Task completed and PR merged" } }
      ]
    },

    // --- PR review agent finds issues → loop back ---
    {
      "id": "t8",
      "from": "pr_review",
      "to": "changes_requested",
      "label": "Changes Requested",
      "trigger": { "type": "agent_outcome", "outcome": "changes_requested" }
      // NOT an error — the agent ran successfully and determined changes are needed
    },

    // --- Rework: send back to implementation with review comments ---
    {
      "id": "t9",
      "from": "changes_requested",
      "to": "in_progress",
      "label": "Rework",
      "trigger": { "type": "any" },

      "guards": [
        {
          "type": "max_iterations",     // prevent infinite review loops
          "params": {
            "statusId": "in_progress",  // count entries into this status
            "max": 5                    // block after 5 round-trips
          }
        }
      ],

      "hooks": [
        { "type": "start_agent", "params": { "mode": "implement" } }
        // agent gets review comments injected via AgentContextBuilder
      ]
    },

    // --- Recovery ---
    { "id": "t10", "from": "failed", "to": "open", "label": "Retry", "trigger": { "type": "manual" } },

    // --- Cancel from any status ---
    {
      "id": "t11",
      "from": "*",                  // wildcard: this transition is valid from ANY status
      "to": "cancelled",
      "label": "Cancel",
      "trigger": { "type": "manual" }
    }
  ]
}
```

### How the engine reads this

```
1. Task is in status "open"
2. Engine calls getValidTransitions("task-123")
3. Engine finds all transitions where from === "open" or from === "*"
   → t1 (Tech Plan), t2 (Skip to Implement), t11 (Cancel)
4. For each, engine checks guards (t1 and t2 have none, so both allowed)
5. UI renders three buttons: [Tech Plan] [Skip to Implement] [Cancel]
6. Admin clicks [Tech Plan]
7. Engine executes transition t1:
   a. Updates task.status = "planning"
   b. Runs hooks in order:
      - start_agent → AgentHandler resolves "claude-code" agent, mode "plan"
      - creates worktree, builds prompt, spawns agent
   c. Logs transition to transition_history
   d. Logs event to task_events
8. Agent runs... finishes with success
9. AgentService calls engine with trigger { type: "agent_outcome", outcome: "plan_complete" }
10. Engine finds t3 (planning → planned, agent_outcome:plan_complete) → auto-executes
```

### Guard `type` → registered guard function

```typescript
// In the JSON:
{ "type": "has_pr", "params": {} }

// Resolves to: the function registered by PrReviewHandler via:
guards.add('has_pr', this.hasPr.bind(this));
```

If `type` doesn't match any registered guard, the engine throws an error at transition time (not at pipeline save time — this allows handlers to be added later).

### Hook `type` → registered hook function

```typescript
// In the JSON:
{ "type": "start_agent", "params": { "agentType": "claude-code", "mode": "implement" } }

// Resolves to: the function registered by AgentHandler via:
hooks.add('start_agent', this.startAgent.bind(this));
```

### Hook `params` — the contract for each hook

Each hook defines its own `params` schema. The JSON passes arbitrary key-value pairs, and the hook function reads what it needs. Here's the catalog:

| Hook | `type` | `params` | What It Does |
|------|--------|----------|--------------|
| Start agent | `start_agent` | `agentType`: string (default: project default), `mode`: `"plan"` \| `"implement"` \| `"review"` \| `"investigate"` \| `"design"`, `model?`: string override | Resolves agent via `agentFramework.getAgent(agentType)`, creates worktree, runs agent with mode-specific prompt |
| Start phase agent | `start_phase_agent` | `agentType?`: string, `mode?`: string (default: `"implement"`) | Like `start_agent` but scoped to the current active phase. Creates phase branch from task branch, scopes all artifacts to the phase. |
| Start PR review | `start_pr_review` | `agentType?`: string (default: `"claude-code"`) | Shorthand for `start_agent` with `mode: "review"` |
| Merge PR | `merge_pr` | (none) | Finds open PR artifact on task, calls `scmPlatform.mergePR()`, updates artifact |
| Merge phase PR | `merge_phase_pr` | (none) | Merges the current phase's PR into the task branch, marks phase as `completed` |
| Advance phase | `advance_phase` | (none) | Sets the next pending phase to `in_progress`. If no more phases, triggers `create_final_pr` instead. |
| Create task branch | `create_task_branch` | (none) | Creates the task integration branch from `main`. One-time, runs when the first phase starts. |
| Create final PR | `create_final_pr` | (none) | Creates PR from task branch → `main`. Stores as task-level artifact (`phaseId: null`). |
| Merge final PR | `merge_final_pr` | (none) | Merges the task branch → `main` PR, transitions task to `done`. |
| Create branch | `create_branch` | `prefix?`: string (default from `config.json`) | Creates git branch, stores as artifact |
| Notify | `notify` | `title?`: string, `notificationType?`: string | Sends notification via all channels |
| Log activity | `log_activity` | (none) | Writes to activity log |
| Inject payload context | `inject_payload_context` | (none) | Assembles payload history into agent context |

### Guard `params` — the contract for each guard

| Guard | `type` | `params` | What It Checks |
|-------|--------|----------|----------------|
| Has plan | `has_plan` | (none) | `task.plan` is not empty |
| Has PR | `has_pr` | (none) | Task has an open `pull_request` artifact |
| No running agent | `no_running_agent` | (none) | No `agent_run` with status=running for this task |
| Dependencies resolved | `dependencies_resolved` | (none) | All dependent tasks are in terminal status |
| Max iterations | `max_iterations` | `statusId`: string, `max`: number (default: 5) | Task hasn't entered `statusId` more than `max` times |
| Has payload response | `has_payload_response` | `payloadType`: string | Human has responded to the pending payload |
| Current phase has PR | `current_phase_has_pr` | (none) | The active phase has a `pull_request` artifact with `state: 'open'` |
| Current phase PR merged | `current_phase_pr_merged` | (none) | The active phase's PR has been merged to the task branch |
| All phases completed | `all_phases_completed` | (none) | Every phase has `status: 'completed'` |
| Has final PR | `has_final_pr` | (none) | A task-level `pull_request` artifact exists for task branch → main |

### How `agentType` resolves

The `agentType` string in `start_agent` params maps to an `IAgent` implementation registered in `IAgentFramework`:

```typescript
// "claude-code" → the agent registered as:
class ClaudeCodeAgent implements IAgent {
  readonly type = 'claude-code';        // ← this must match the JSON string
  readonly displayName = 'Claude Code';
}

// "cursor" → (Phase 3)
class CursorAgent implements IAgent {
  readonly type = 'cursor';
  readonly displayName = 'Cursor';
}
```

The resolution chain:
```
JSON: { "agentType": "claude-code" }
  → AgentHandler reads params.agentType
  → calls agentFramework.getAgent("claude-code")
  → returns the IAgent with type === "claude-code"
  → calls agent.run({ mode, prompt, ... })
```

If `agentType` is omitted, the project's `defaultAgentType` is used. If that's also not set, falls back to `"claude-code"`.

### How `mode` resolves

The `mode` string determines the **prompt template** and **agent behavior**:

| Mode | Prompt Focus | Agent Behavior |
|------|-------------|----------------|
| `plan` | "Analyze and create an implementation plan. Do NOT write code." | Reads codebase, outputs plan markdown |
| `implement` | "Implement this task. Write code, create/modify files." | Writes code, commits, creates PR |
| `review` | "Review this PR for issues." | Reads diff, outputs review with approve/request-changes |
| `investigate` | "Investigate this bug. Find the root cause." | Reads codebase, outputs investigation report |
| `design` | "Create a UX/technical design for this feature." | Outputs design document |

Modes are not hardcoded — they're just strings passed to `AgentContextBuilder.build(taskId, mode)` which selects the appropriate prompt template. Adding a new mode = adding a new prompt template. No engine changes.

### Validation

The pipeline engine validates the JSON on two levels:

1. **Structure validation (at pipeline save time):** Statuses exist, transitions reference valid status IDs, `initialStatus` and `terminalStatuses` are valid.
2. **Runtime validation (at transition time):** Guard/hook `type` strings are looked up in registries. If not found → error logged to event log, transition fails gracefully.

This split allows pipelines to reference guards/hooks that will be added in future phases without blocking pipeline creation.

---

## Guards and Hooks (Types)

Guards are conditions checked BEFORE a transition. Hooks are actions executed AFTER.

```typescript
type GuardFn = (task: Task, ctx: PipelineContext) => boolean | Promise<boolean>;

type HookFn = (
  task: Task,
  transition: PipelineTransition,
  ctx: PipelineContext,
  params: Record<string, any>
) => Promise<void>;
```

Guards and hooks are **not** stored in flat global registries. They're organized into **handlers** — feature modules that group related guards and hooks together.

### Handlers: Organized by Feature

Each handler is a self-contained module for one workflow concern. It registers the guards and hooks it provides. All logic for that concern lives in one file.

```typescript
// src/main/handlers/handler.ts — the interface all handlers implement

interface IPipelineHandler {
  readonly name: string;
  register(guards: GuardRegistry, hooks: HookRegistry): void;
}

class GuardRegistry {
  private guards: Map<string, GuardFn> = new Map();
  add(name: string, fn: GuardFn): void { this.guards.set(name, fn); }
  get(name: string): GuardFn | undefined { return this.guards.get(name); }
}

class HookRegistry {
  private hooks: Map<string, HookFn> = new Map();
  add(name: string, fn: HookFn): void { this.hooks.set(name, fn); }
  get(name: string): HookFn | undefined { return this.hooks.get(name); }
}
```

**Built-in handlers:**

```
src/main/handlers/
├── core-handler.ts              # Basic guards: has_plan, has_branch, no_running_agent, dependencies_resolved
├── agent-handler.ts             # start_agent, stop_agent hooks
├── git-handler.ts               # create_branch, create_worktree hooks
├── pr-review-handler.ts         # has_pr guard, merge_pr hook, start_pr_review hook
├── notification-handler.ts      # notify hook
├── activity-handler.ts          # log_activity hook
└── payload-handler.ts           # has_payload_response guard, inject_payload_context hook
```

### Example: The PR Review Handler

All PR review logic lives in one file:

```typescript
// src/main/handlers/pr-review-handler.ts

export class PrReviewHandler implements IPipelineHandler {
  readonly name = 'pr-review';

  constructor(
    private taskStore: ITaskStore,
    private scmPlatform: IScmPlatform,
    private agentService: AgentService,
  ) {}

  register(guards: GuardRegistry, hooks: HookRegistry) {
    guards.add('has_pr', this.hasPr.bind(this));
    hooks.add('start_pr_review', this.startPrReview.bind(this));
    hooks.add('merge_pr', this.mergePr.bind(this));
  }

  // Guard: task must have an open PR artifact
  private async hasPr(task: Task): Promise<boolean> {
    const artifacts = await this.taskStore.listArtifacts(task.id, 'pull_request');
    return artifacts.some(a => a.metadata?.state === 'open');
  }

  // Hook: start a PR review agent
  private async startPrReview(task: Task, transition: PipelineTransition, ctx: PipelineContext, params: Record<string, any>) {
    await this.agentService.start(task.id, 'review', {
      agentType: params.agentType || 'claude-code',
    });
  }

  // Hook: merge PR via SCM platform, update artifact
  private async mergePr(task: Task, transition: PipelineTransition, ctx: PipelineContext) {
    const artifacts = await this.taskStore.listArtifacts(task.id, 'pull_request');
    const pr = artifacts.find(a => a.metadata?.state === 'open');
    if (!pr) throw new Error('No open PR found for this task');

    const repoInfo = await this.scmPlatform.getRepoInfo(ctx.project.path);
    await this.scmPlatform.mergePR(repoInfo.url, pr.metadata.prNumber);

    await this.taskStore.updateArtifact(pr.id, {
      metadata: { ...pr.metadata, state: 'merged', mergedAt: new Date().toISOString() },
    });
  }
}
```

### Example: The Core Handler

Basic guards that many pipelines use:

```typescript
// src/main/handlers/core-handler.ts

export class CoreHandler implements IPipelineHandler {
  readonly name = 'core';

  constructor(
    private taskStore: ITaskStore,
    private agentService: AgentService,
  ) {}

  register(guards: GuardRegistry, hooks: HookRegistry) {
    guards.add('has_plan', this.hasPlan.bind(this));
    guards.add('has_branch', this.hasBranch.bind(this));
    guards.add('no_running_agent', this.noRunningAgent.bind(this));
    guards.add('dependencies_resolved', this.dependenciesResolved.bind(this));
    guards.add('max_iterations', this.maxIterations.bind(this));
  }

  private hasPlan(task: Task): boolean { return !!task.plan; }
  private hasBranch(task: Task): boolean { return !!task.branchName; }

  private async noRunningAgent(task: Task): Promise<boolean> {
    return !this.agentService.isRunning(task.id);
  }

  private async dependenciesResolved(task: Task, ctx: PipelineContext): Promise<boolean> {
    const deps = await this.taskStore.getDependencies(task.id);
    return deps.every(d => ctx.pipelineEngine.isTerminal(d.pipelineId, d.status));
  }

  private async maxIterations(task: Task, ctx: PipelineContext): Promise<boolean> {
    const params = ctx.guardParams;
    const maxLoops = params?.max || 5;
    const history = await ctx.eventLog.list(task.id, { category: ['transition'] });
    const entryCount = history.filter(e => e.data?.to === params?.statusId).length;
    return entryCount < maxLoops;
  }
}
```

### Wiring It All Together

The composition root creates all handlers and passes them to the engine:

```typescript
// In src/main/providers/setup.ts

// Create handlers
const coreHandler = new CoreHandler(taskStore, agentService);
const agentHandler = new AgentHandler(agentService, worktreeManager);
const gitHandler = new GitHandler(gitOps, taskStore);
const prReviewHandler = new PrReviewHandler(taskStore, scmPlatform, agentService);
const notificationHandler = new NotificationHandler(notifier);
const activityHandler = new ActivityHandler(activityLog);
const payloadHandler = new PayloadHandler(taskStore, eventLog);

// Create engine with all handlers
const pipelineEngine = new PipelineEngineImpl(
  taskStore, pipelineStore, eventLog,
  [coreHandler, agentHandler, gitHandler, prReviewHandler,
   notificationHandler, activityHandler, payloadHandler]
);
```

### Your Exact Example: Adding a PR Reviewer Agent

**Before:** Admin manually reviews PRs.
Pipeline JSON has: `in_progress → pr_review (manual)` → admin clicks "Merge & Complete".

**After:** PR reviewer agent reviews automatically, admin only merges.

**Step 1:** The `PrReviewHandler` already has `start_pr_review` hook. No code changes needed.

**Step 2:** Update the pipeline JSON (database edit or settings UI):

```json
// BEFORE: admin reviews manually
{
  "from": "in_progress", "to": "pr_review",
  "trigger": { "type": "agent_outcome", "outcome": "pr_ready" },
  "hooks": []
}

// AFTER: PR reviewer agent starts automatically
{
  "from": "in_progress", "to": "pr_review",
  "trigger": { "type": "agent_outcome", "outcome": "pr_ready" },
  "hooks": [{ "type": "start_pr_review", "params": { "agentType": "claude-code" } }]
}
```

**Step 3:** Add transitions for the agent's output:
```json
{
  "from": "pr_review", "to": "changes_requested",
  "trigger": { "type": "agent_outcome", "outcome": "changes_requested" },
  "hooks": [{ "type": "notify", "params": { "title": "PR Review: Changes Requested" } }]
},
{
  "from": "pr_review", "to": "approved",
  "trigger": { "type": "agent_outcome", "outcome": "approved" }
},
{
  "from": "approved", "to": "done",
  "trigger": { "type": "manual" },
  "guards": [{ "type": "has_pr" }],
  "hooks": [{ "type": "merge_pr" }]
}
```

**That's it.** No engine changes. No handler changes. Just JSON wiring.

### When You DO Need New Code

If you need behavior that no existing handler provides, you write a new handler:

**Example: Adding a "Security Scan" step**

1. Create the handler:
```typescript
// src/main/handlers/security-scan-handler.ts
export class SecurityScanHandler implements IPipelineHandler {
  readonly name = 'security-scan';

  register(guards: GuardRegistry, hooks: HookRegistry) {
    guards.add('scan_passed', this.scanPassed.bind(this));
    hooks.add('start_security_scan', this.startScan.bind(this));
  }

  private async scanPassed(task: Task): Promise<boolean> { /* ... */ }
  private async startScan(task: Task, ...): Promise<void> { /* ... */ }
}
```

2. Register in setup.ts:
```typescript
const securityHandler = new SecurityScanHandler(scanService);
// Add to the handlers array passed to PipelineEngineImpl
```

3. Update pipeline JSON to use the new guards/hooks.

**The rule:** adding a new capability = new handler file + composition root registration + pipeline JSON update. The engine never changes. Existing handlers never change.

---

## Multiple Pipelines + Optional Steps

### Why Multiple Pipelines

Different task types have fundamentally different workflows:

- **Bug** — investigate first, then fix. No planning/design phase needed.
- **Feature** — may need UX design, technical design, planning before implementation.
- **Small fix / chore** — just implement and merge. Minimal process.

These aren't just different statuses — the *shape* of the flow is different. A bug pipeline is linear (investigate → fix → review). A feature pipeline has optional branches (design → plan → implement).

### Optional Steps via Skip Transitions

Within a pipeline, some steps are **optional**. Not every feature needs UX design. Not every feature needs a technical planning agent. The pipeline supports this through **multiple paths from the same status** — the admin (or workflow rules) picks the right path.

```
Feature Pipeline with optional steps:

                    ┌── "Needs UX Design" ──→ (UX Design) ──→ (Design Review) ──┐
                    │                                                             │
(Open) ─────────────┼── "Needs Tech Design" ──→ (Tech Design) ──→ (Planned) ────┼──→ (In Progress) → ...
                    │                                                             │
                    └── "Skip to Implement" ──────────────────────────────────────┘
```

The admin sees three buttons on an open task: "Needs UX Design", "Needs Tech Design", "Skip to Implement". Each is a valid transition. The pipeline doesn't force a single path — it offers choices.

### Pipeline Selection

When creating a task, the admin selects a pipeline:

```
┌────────────────────────────────────────────┐
│ New Task                                    │
│                                             │
│ Title: [________________________]           │
│ Type:  [Feature ▼]     ← auto-picks pipeline│
│ Pipeline: [Feature Pipeline ▼]  ← or manual │
│                                             │
│ ...                                         │
└────────────────────────────────────────────┘
```

Projects can have a **default pipeline per task type** mapping:
```typescript
interface ProjectPipelineConfig {
  defaultPipeline: string;         // fallback pipeline ID
  pipelineByType: {                // per-type overrides
    bug: string;                   // pipeline ID for bugs
    feature: string;               // pipeline ID for features
    chore: string;                 // pipeline ID for chores
    [customType: string]: string;  // extensible
  };
}
```

---

## Built-in Pipelines

### 1. Simple (Phase 1 default)

Minimal workflow. No agents, no review. For getting started.

```
Open → In Progress → Done
```

```json
{
  "id": "simple",
  "name": "Simple",
  "isDefault": true,
  "initialStatus": "open",
  "terminalStatuses": ["done", "cancelled"],
  "statuses": [
    { "id": "open",        "label": "Open",        "color": "#6b7280", "category": "backlog",  "position": 0 },
    { "id": "in_progress", "label": "In Progress",  "color": "#3b82f6", "category": "active",   "position": 1 },
    { "id": "done",        "label": "Done",         "color": "#22c55e", "category": "done",     "position": 2 },
    { "id": "cancelled",   "label": "Cancelled",    "color": "#9ca3af", "category": "done",     "position": 3 }
  ],
  "transitions": [
    { "id": "t1", "from": "open",        "to": "in_progress", "label": "Start",     "trigger": { "type": "any" } },
    { "id": "t2", "from": "in_progress", "to": "done",        "label": "Complete",   "trigger": { "type": "any" } },
    { "id": "t3", "from": "in_progress", "to": "open",        "label": "Send Back",  "trigger": { "type": "any" } },
    { "id": "t4", "from": "*",           "to": "cancelled",   "label": "Cancel",     "trigger": { "type": "manual" } }
  ]
}
```

### 2. Bug Pipeline

Linear flow: investigate → fix → review → merge. No planning/design phase.

```
Open → Investigating → Fix In Progress → PR Review ⇄ Changes Requested → Done
```

```json
{
  "id": "bug",
  "name": "Bug",
  "initialStatus": "open",
  "terminalStatuses": ["done", "cancelled"],
  "statuses": [
    { "id": "open",               "label": "Open",               "color": "#6b7280", "category": "backlog",  "position": 0 },
    { "id": "investigating",      "label": "Investigating",       "color": "#8b5cf6", "category": "active",   "position": 1 },
    { "id": "fix_in_progress",    "label": "Fix In Progress",     "color": "#3b82f6", "category": "active",   "position": 2 },
    { "id": "pr_review",          "label": "PR Review",           "color": "#f59e0b", "category": "review",   "position": 3 },
    { "id": "changes_requested",  "label": "Changes Requested",   "color": "#ef4444", "category": "active",   "position": 4 },
    { "id": "done",               "label": "Done",                "color": "#22c55e", "category": "done",     "position": 5 },
    { "id": "failed",             "label": "Failed",              "color": "#dc2626", "category": "blocked",  "position": 6 },
    { "id": "cancelled",          "label": "Cancelled",           "color": "#9ca3af", "category": "done",     "position": 7 }
  ],
  "transitions": [
    { "id": "t1",  "from": "open",               "to": "investigating",      "label": "Investigate",          "trigger": { "type": "any" },    "hooks": [{ "type": "start_agent", "params": { "mode": "investigate" } }] },
    { "id": "t2",  "from": "open",               "to": "fix_in_progress",    "label": "Fix (skip investigate)", "trigger": { "type": "any" },  "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },
    { "id": "t3",  "from": "investigating",      "to": "fix_in_progress",    "label": "Start Fix",            "trigger": { "type": "agent_outcome", "outcome": "reproduced" }, "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },
    { "id": "t4",  "from": "investigating",      "to": "failed",             "label": "Cannot Reproduce",     "trigger": { "type": "agent_outcome", "outcome": "cannot_reproduce" } },
    { "id": "t5",  "from": "fix_in_progress",    "to": "pr_review",          "label": "Ready for Review",     "trigger": { "type": "agent_outcome", "outcome": "pr_ready" }, "hooks": [{ "type": "start_pr_review" }] },
    { "id": "t6",  "from": "fix_in_progress",    "to": "failed",             "label": "Fix Failed",           "trigger": { "type": "agent_error" } },
    { "id": "t7",  "from": "pr_review",          "to": "done",               "label": "Merge & Complete",     "trigger": { "type": "manual" }, "guards": [{ "type": "has_pr" }], "hooks": [{ "type": "merge_pr" }] },
    { "id": "t8",  "from": "pr_review",          "to": "changes_requested",  "label": "Changes Requested",    "trigger": { "type": "agent_outcome", "outcome": "changes_requested" } },
    { "id": "t9",  "from": "changes_requested",  "to": "fix_in_progress",    "label": "Rework",               "trigger": { "type": "any" },    "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },
    { "id": "t10", "from": "failed",             "to": "open",               "label": "Retry",                "trigger": { "type": "manual" } },
    { "id": "t11", "from": "*",                  "to": "cancelled",          "label": "Cancel",               "trigger": { "type": "manual" } }
  ]
}
```

### 3. Feature Pipeline

Full workflow with **optional** UX design and technical planning phases. Admin picks which steps are needed per task.

```
         ┌── "UX Design" ──→ (UX Design) ──→ (Design Review) ──┐
         │                                                       │
(Open) ──┼── "Tech Plan" ──→ (Planning) ──→ (Planned) ─────────┼──→ (In Progress) → PR Review ⇄ Changes Requested → Done
         │                                                       │
         └── "Skip to Implement" ───────────────────────────────┘
```

```json
{
  "id": "feature",
  "name": "Feature",
  "initialStatus": "open",
  "terminalStatuses": ["done", "cancelled"],
  "statuses": [
    { "id": "open",               "label": "Open",               "color": "#6b7280", "category": "backlog",  "position": 0 },
    { "id": "ux_design",          "label": "UX Design",           "color": "#ec4899", "category": "active",   "position": 1 },
    { "id": "design_review",      "label": "Design Review",       "color": "#f472b6", "category": "waiting",  "position": 2 },
    { "id": "planning",           "label": "Tech Planning",       "color": "#8b5cf6", "category": "active",   "position": 3 },
    { "id": "planned",            "label": "Planned",             "color": "#a78bfa", "category": "backlog",  "position": 4 },
    { "id": "in_progress",        "label": "In Progress",         "color": "#3b82f6", "category": "active",   "position": 5 },
    { "id": "pr_review",          "label": "PR Review",           "color": "#f59e0b", "category": "review",   "position": 6 },
    { "id": "changes_requested",  "label": "Changes Requested",   "color": "#ef4444", "category": "active",   "position": 7 },
    { "id": "done",               "label": "Done",                "color": "#22c55e", "category": "done",     "position": 8 },
    { "id": "failed",             "label": "Failed",              "color": "#dc2626", "category": "blocked",  "position": 9 },
    { "id": "cancelled",          "label": "Cancelled",           "color": "#9ca3af", "category": "done",     "position": 10 }
  ],
  "transitions": [
    // === From Open: admin picks the path ===
    { "id": "t1",  "from": "open",               "to": "ux_design",          "label": "UX Design",            "trigger": { "type": "manual" },  "hooks": [{ "type": "start_agent", "params": { "mode": "design" } }] },
    { "id": "t2",  "from": "open",               "to": "planning",           "label": "Tech Plan",            "trigger": { "type": "any" },     "hooks": [{ "type": "start_agent", "params": { "mode": "plan" } }] },
    { "id": "t3",  "from": "open",               "to": "in_progress",        "label": "Skip to Implement",    "trigger": { "type": "any" },     "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },

    // === UX Design path ===
    { "id": "t4",  "from": "ux_design",          "to": "design_review",      "label": "Design Ready",         "trigger": { "type": "agent_outcome", "outcome": "design_ready" } },
    { "id": "t5",  "from": "design_review",      "to": "planning",           "label": "Approved → Plan",      "trigger": { "type": "manual" },  "hooks": [{ "type": "start_agent", "params": { "mode": "plan" } }] },
    { "id": "t6",  "from": "design_review",      "to": "in_progress",        "label": "Approved → Implement", "trigger": { "type": "manual" },  "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },
    { "id": "t7",  "from": "design_review",      "to": "ux_design",          "label": "Revise Design",        "trigger": { "type": "manual" },  "hooks": [{ "type": "start_agent", "params": { "mode": "design" } }] },

    // === Tech Planning path ===
    { "id": "t8",  "from": "planning",           "to": "planned",            "label": "Planning Complete",    "trigger": { "type": "agent_outcome", "outcome": "plan_complete" } },
    { "id": "t9",  "from": "planning",           "to": "failed",             "label": "Planning Failed",      "trigger": { "type": "agent_error" } },
    { "id": "t10", "from": "planned",            "to": "in_progress",        "label": "Implement",            "trigger": { "type": "any" },     "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },

    // === Implementation + Review (shared by all paths) ===
    { "id": "t11", "from": "in_progress",        "to": "pr_review",          "label": "Ready for Review",     "trigger": { "type": "agent_outcome", "outcome": "pr_ready" }, "hooks": [{ "type": "start_pr_review" }] },
    { "id": "t12", "from": "in_progress",        "to": "failed",             "label": "Implementation Failed","trigger": { "type": "agent_error" } },
    { "id": "t13", "from": "pr_review",          "to": "done",               "label": "Merge & Complete",     "trigger": { "type": "manual" },  "guards": [{ "type": "has_pr" }], "hooks": [{ "type": "merge_pr" }] },
    { "id": "t14", "from": "pr_review",          "to": "changes_requested",  "label": "Changes Requested",    "trigger": { "type": "agent_outcome", "outcome": "changes_requested" } },
    { "id": "t15", "from": "changes_requested",  "to": "in_progress",        "label": "Rework",               "trigger": { "type": "any" },     "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },

    // === Recovery + Cancel ===
    { "id": "t16", "from": "failed",             "to": "open",               "label": "Retry",                "trigger": { "type": "manual" } },
    { "id": "t17", "from": "*",                  "to": "cancelled",          "label": "Cancel",               "trigger": { "type": "manual" } }
  ]
}
```

**What the admin sees on an open feature task:**
```
[UX Design]  [Tech Plan]  [Skip to Implement]
```
Three buttons. Pick the path that fits this task. Small task → skip. Complex feature → UX Design first. Technical task → Tech Plan.

### 4. Small Fix / Chore Pipeline

Minimal process. Implement → review → done. No investigation, no planning.

```
Open → In Progress → PR Review → Done
```

```json
{
  "id": "chore",
  "name": "Small Fix / Chore",
  "initialStatus": "open",
  "terminalStatuses": ["done", "cancelled"],
  "statuses": [
    { "id": "open",               "label": "Open",               "color": "#6b7280", "category": "backlog",  "position": 0 },
    { "id": "in_progress",        "label": "In Progress",         "color": "#3b82f6", "category": "active",   "position": 1 },
    { "id": "pr_review",          "label": "PR Review",           "color": "#f59e0b", "category": "review",   "position": 2 },
    { "id": "done",               "label": "Done",                "color": "#22c55e", "category": "done",     "position": 3 },
    { "id": "cancelled",          "label": "Cancelled",           "color": "#9ca3af", "category": "done",     "position": 4 }
  ],
  "transitions": [
    { "id": "t1", "from": "open",         "to": "in_progress", "label": "Implement",         "trigger": { "type": "any" },    "hooks": [{ "type": "start_agent", "params": { "mode": "implement" } }] },
    { "id": "t2", "from": "in_progress",  "to": "pr_review",   "label": "Ready for Review",  "trigger": { "type": "agent_outcome", "outcome": "pr_ready" }, "hooks": [{ "type": "start_pr_review" }] },
    { "id": "t3", "from": "pr_review",    "to": "done",        "label": "Merge & Complete",  "trigger": { "type": "manual" }, "guards": [{ "type": "has_pr" }], "hooks": [{ "type": "merge_pr" }] },
    { "id": "t4", "from": "*",            "to": "cancelled",   "label": "Cancel",            "trigger": { "type": "manual" } }
  ]
}
```

### Summary: Which Pipeline For What

| Pipeline | Use Case | Optional Steps | Complexity |
|----------|----------|----------------|------------|
| **Simple** | Phase 1, no agents | None | Minimal |
| **Bug** | Bug fixes | Investigation (skippable) | Low |
| **Chore** | Small fixes, refactors, deps | None | Low |
| **Feature** | New features, enhancements | UX Design, Tech Planning (both skippable) | Medium |

Admins can create custom pipelines for their specific workflows (e.g., "Security Fix" with mandatory security review, "API Feature" with mandatory API design review).

### Pipeline Assigned at Task Creation

```typescript
// When creating a task, pipeline is selected based on task type
interface CreateTaskInput {
  // ... existing fields ...
  type?: string;        // 'bug', 'feature', 'chore', custom
  pipelineId?: string;  // explicit override, or auto-selected from type
}
```

The UI auto-selects the pipeline based on task type (using `ProjectPipelineConfig`), but the admin can override it. Once assigned, the pipeline can be changed on the task if needed (with the constraint that the current status must exist in the new pipeline).

---

## Extensibility: Adding a New Guard or Hook

### Adding a guard

1. Write the function:
```typescript
// src/main/implementations/guards/has-tests.ts
export const hasTests: GuardFn = async (task, ctx) => {
  // Check if task branch has test files changed
  const diff = await ctx.gitOps.getDiffStats(ctx.project.path, {
    baseBranch: 'main',
    headBranch: task.branchName,
  });
  return diff.some(f => f.filePath.includes('.test.') || f.filePath.includes('.spec.'));
};
```

2. Register it:
```typescript
guardRegistry.register('has_tests', hasTests);
```

3. Use it in a pipeline definition:
```json
{
  "from": "in_progress",
  "to": "pr_review",
  "guards": [{ "type": "has_tests" }]
}
```

Done. No changes to engine, UI, or any other code.

### Adding a hook

Same pattern:
1. Write the function
2. Register it
3. Reference it in a pipeline transition's `hooks` array
