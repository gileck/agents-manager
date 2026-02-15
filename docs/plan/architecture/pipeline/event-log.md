# Task Event Log

Every significant event on a task is captured in a single chronological stream. This is the single source of truth for 'what happened on this task' — used for debugging, audit trails, and agent context assembly.

See also: [engine.md](engine.md) | [json-contract.md](json-contract.md) | [outcome-schemas.md](outcome-schemas.md) | [errors.md](errors.md) | [ui.md](ui.md)

---

## The Problem

When debugging "why is this task stuck?" or "what went wrong?", you need to see **everything** that happened on a task in one place. Not just status changes - everything.

## What Gets Logged

The task event log captures every significant event in a single chronological stream:

```typescript
interface TaskEvent {
  id: string;
  taskId: string;
  timestamp: string;

  // Event categorization
  category: TaskEventCategory;
  type: string;              // specific event type within category

  // Human-readable summary (always present)
  summary: string;

  // Structured data (varies by event type)
  data?: Record<string, any>;

  // Who caused this event
  actor: {
    type: 'user' | 'agent' | 'system' | 'supervisor';
    name?: string;            // agent type, hook name, guard name, etc.
    agentRunId?: string;
  };

  // Severity for filtering
  level: 'info' | 'warning' | 'error' | 'debug';
}

type TaskEventCategory =
  | 'lifecycle'      // task created, deleted
  | 'transition'     // status changed
  | 'agent'          // agent started, output, completed, failed
  | 'payload'        // payload attached, responded to
  | 'guard'          // guard checked (passed or failed)
  | 'hook'           // hook executed (success or failure)
  | 'edit'           // task fields edited
  | 'dependency'     // dependency added/removed
  | 'note'           // note added
  | 'git'            // branch created, PR created, commits
  | 'error';         // unexpected errors
```

> **Note:** `'hook'` and `'guard'` are not separate actor types — they use `actor.type = 'system'` with `actor.name` set to the hook/guard name (e.g., `{ type: 'system', name: 'guard:has_plan' }` or `{ type: 'system', name: 'hook:start_agent' }`).

## Event Types (non-exhaustive, grows over time)

| Category | Type | Level | Example Summary |
|----------|------|-------|-----------------|
| lifecycle | task.created | info | Task created |
| lifecycle | task.deleted | info | Task deleted |
| edit | field.updated | info | Priority changed from 'medium' to 'high' |
| edit | description.updated | info | Description updated |
| transition | status.changed | info | Status: open → in_progress (by user) |
| transition | status.changed | info | Status: in_progress → needs_info (by agent, run #5) |
| transition | status.blocked | warning | Transition to 'in_progress' blocked: guard 'dependencies_resolved' failed |
| agent | agent.started | info | Claude Code started (implement mode) - Run #5 |
| agent | agent.message | debug | Agent: "I'll start by creating the auth middleware..." |
| agent | agent.tool_use | debug | Agent used tool: Write src/middleware/auth.ts |
| agent | agent.completed | info | Claude Code completed in 2m 34s ($0.12) |
| agent | agent.failed | error | Claude Code failed: timeout after 10m |
| agent | agent.cancelled | warning | Agent cancelled by user |
| payload | needs_info.sent | warning | Agent needs info: 2 questions pending |
| payload | info.provided | info | Admin answered 2 questions |
| payload | options.proposed | warning | Agent proposed 3 implementation options |
| payload | option.selected | info | Admin selected "Option A: Repository Pattern" |
| payload | changes.requested | warning | PR review: 2 must-fix, 1 suggestion |
| payload | changes.acknowledged | info | Admin sent task back for rework with 1 comment |
| guard | guard.passed | debug | Guard 'has_plan' passed |
| guard | guard.failed | warning | Guard 'dependencies_resolved' failed: Task #12 still in 'open' |
| hook | hook.executed | info | Hook 'start_agent' executed successfully |
| hook | hook.failed | error | Hook 'create_branch' failed: branch already exists |
| git | branch.created | info | Branch 'task/abc-123' created |
| git | commit.pushed | info | 3 commits pushed to 'task/abc-123' |
| git | pr.created | info | PR #45 created: "Add authentication middleware" |
| note | note.added | info | User added note: "Check the auth middleware first" |
| dependency | dep.added | info | Dependency added: blocked by Task #12 |
| dependency | dep.resolved | info | Dependency resolved: Task #12 completed |
| error | unexpected | error | Unexpected error in hook 'notify': connection refused |

## Interface

```typescript
interface ITaskEventLog {
  // Log an event
  log(event: Omit<TaskEvent, 'id' | 'timestamp'>): Promise<void>;

  // Query events for a task
  list(taskId: string, filters?: TaskEventFilters): Promise<TaskEvent[]>;

  // Get events across all tasks (for project-level debugging)
  listByProject(projectId: string, filters?: TaskEventFilters): Promise<TaskEvent[]>;
}

interface TaskEventFilters {
  category?: TaskEventCategory[];
  level?: ('info' | 'warning' | 'error' | 'debug')[];
  since?: string;         // ISO date
  until?: string;         // ISO date
  actorType?: string;
  limit?: number;
  offset?: number;
}
```

## Where Events Are Logged

Events are logged from **inside the pipeline engine and services**, not from the UI. This ensures nothing is missed:

```typescript
// Pipeline engine logs transitions, guards, hooks automatically
class PipelineEngineImpl implements IPipelineEngine {
  async transition(taskId: string, toStatus: string, context: TransitionContext) {
    const task = await this.taskStore.getTask(taskId);

    // Log guard checks
    for (const guard of transition.guards) {
      const result = await this.checkGuard(guard, task);
      await this.eventLog.log({
        taskId,
        category: 'guard',
        type: result.passed ? 'guard.passed' : 'guard.failed',
        summary: `Guard '${guard.type}' ${result.passed ? 'passed' : 'failed'}`,
        data: { guard: guard.type, params: guard.params, result },
        actor: { type: 'system', name: `guard:${guard.type}` },
        level: result.passed ? 'debug' : 'warning',
      });

      if (!result.passed) {
        // Log the blocked transition
        await this.eventLog.log({
          taskId,
          category: 'transition',
          type: 'status.blocked',
          summary: `Transition to '${toStatus}' blocked: guard '${guard.type}' failed`,
          data: { from: task.status, to: toStatus, guard: guard.type, reason: result.reason },
          actor: context.triggeredBy === 'agent'
            ? { type: 'agent', agentRunId: context.agentRunId }
            : { type: context.triggeredBy },
          level: 'warning',
        });
        return { success: false, blockedBy: [result.reason] };
      }
    }

    // Execute transition
    // ... update task status ...

    // Log the transition
    await this.eventLog.log({
      taskId,
      category: 'transition',
      type: 'status.changed',
      summary: `Status: ${task.status} → ${toStatus} (by ${context.triggeredBy})`,
      data: {
        from: task.status,
        to: toStatus,
        transitionId: transition.id,
        payload: context.payload,
      },
      actor: context.triggeredBy === 'agent'
        ? { type: 'agent', agentRunId: context.agentRunId }
        : { type: context.triggeredBy },
      level: 'info',
    });

    // Execute and log hooks
    for (const hook of transition.hooks) {
      try {
        await this.executeHook(hook, task, transition, context);
        await this.eventLog.log({
          taskId,
          category: 'hook',
          type: 'hook.executed',
          summary: `Hook '${hook.type}' executed successfully`,
          data: { hook: hook.type, params: hook.params },
          actor: { type: 'system', name: `hook:${hook.type}` },
          level: 'info',
        });
      } catch (err) {
        await this.eventLog.log({
          taskId,
          category: 'hook',
          type: 'hook.failed',
          summary: `Hook '${hook.type}' failed: ${err.message}`,
          data: { hook: hook.type, params: hook.params, error: err.message },
          actor: { type: 'system', name: `hook:${hook.type}` },
          level: 'error',
        });
      }
    }
  }
}

// Agent service logs agent lifecycle
class AgentServiceImpl {
  async start(taskId: string, mode: string, config: AgentConfig) {
    await this.eventLog.log({
      taskId,
      category: 'agent',
      type: 'agent.started',
      summary: `${config.agentType} started (${mode} mode)`,
      data: { agentType: config.agentType, mode, model: config.model, runId },
      actor: { type: 'agent', name: config.agentType, agentRunId: runId },
      level: 'info',
    });
  }

  // Agent streaming output - log key messages (not every token)
  onAgentMessage(runId: string, message: AgentMessage) {
    if (message.toolUse) {
      this.eventLog.log({
        taskId: this.getTaskId(runId),
        category: 'agent',
        type: 'agent.tool_use',
        summary: `Agent used tool: ${message.toolUse.map(t => `${t.name} ${t.input?.file_path || ''}`).join(', ')}`,
        data: { tools: message.toolUse.map(t => ({ name: t.name, input: t.input })) },
        actor: { type: 'agent', agentRunId: runId },
        level: 'debug',
      });
    }
  }
}
```

## UI: Task Event Log Viewer

The event log viewer is a dedicated section on the task detail page. It's the **single source of truth** for "what happened on this task."

```
┌─────────────────────────────────────────────────────────────┐
│ Event Log                                                    │
│                                                              │
│ Filter: [All ▼]  Level: [Info+ ▼]  Search: [___________]   │
│         Categories      Hide debug                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ 10:06 ⚠ PAYLOAD  Agent needs info: 2 questions pending      │
│                   "What auth provider?" "Support social?"    │
│                                                              │
│ 10:05 ℹ AGENT    Claude Code completed in 45s ($0.03)       │
│                   Run #5 - plan mode                         │
│                                                              │
│ 10:05 🔧 AGENT   Agent used tool: Write docs/plan.md        │
│                                                              │
│ 10:04 🔧 AGENT   Agent used tool: Read src/auth/index.ts    │
│                                                              │
│ 10:04 ℹ AGENT    Claude Code started (plan mode)            │
│                   Run #5                                     │
│                                                              │
│ 10:04 ℹ TRANS    Status: open → planning (by user)          │
│                                                              │
│ 10:04 ✓ GUARD    Guard 'no_running_agent' passed            │
│                                                              │
│ 10:03 ℹ EDIT     Priority changed: medium → high            │
│                                                              │
│ 10:00 ℹ LIFE     Task created                               │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Showing 10 events │ [Load More]                             │
└─────────────────────────────────────────────────────────────┘
```

**Filtering:**
- By category (lifecycle, transition, agent, payload, guard, hook, etc.)
- By level (show debug, info+, warning+, error only)
- By time range
- Text search across summaries

**Color coding:**
- ℹ info = neutral/blue
- ⚠ warning = yellow
- ❌ error = red
- 🔧 debug = gray (hidden by default)

**Expandable rows:** Click any event to see full structured data.

## Quick Diagnosis

The event log enables fast answers to common debugging questions:

| Question | How to find the answer |
|----------|----------------------|
| "Why is this task stuck?" | Filter to `warning` + `error` level → see last guard failure or hook error |
| "What did the agent change?" | Filter to `agent` category → see tool_use events with file paths |
| "Why did the agent ask for info?" | Filter to `payload` → see the NeedsInfoPayload with questions and context |
| "Who moved this to 'done'?" | Filter to `transition` → see the actor on the status.changed event |
| "Why can't I move to 'in_progress'?" | Click the disabled button → tooltip shows guard failure. Also visible in event log as `guard.failed` |
| "What option did the admin pick?" | Filter to `payload` → see `option.selected` event with the choice |
| "How many times did this loop through PR review?" | Filter to `transition` with `to: pr_review` → count entries |
| "Why did the hook fail?" | Filter to `hook` category, `error` level → see error message and stack trace |
