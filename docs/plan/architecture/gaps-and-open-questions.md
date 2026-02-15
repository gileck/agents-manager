# Open Architecture Decisions

Remaining decisions that need to be made before implementation. All contradictions and straightforward gaps have been resolved in the respective docs.

---

## 1. `agent_configs` Table Role + Config Resolution Chain

**The question:** Three config sources exist for agent settings. What's the exact role of each, and what's the merge order?

| Source | Location | Version-controlled? | Scope |
|--------|----------|---------------------|-------|
| `agent_configs` table | SQLite DB | No | Global defaults (project_id IS NULL) |
| `config.json` → `agents` | `.agents-manager/config.json` on disk | Yes (git) | Per-project overrides |
| Per-run overrides | Passed from UI/CLI at run time | No | Single run |

**Sub-questions:**
- Should `agent_configs` exist at all, or should global defaults go in the `settings` table?
- Should `agent_configs` support per-project rows (project_id = X), or is that entirely `config.json`'s job now?
- What's the `settings` table for? Just UI preferences (theme, window size)?

**Options:**

**A: Three-layer system (Recommended)**
```
1. Agent default config        (IAgent.getDefaultConfig())
2. Global user config          (agent_configs table, project_id IS NULL)
3. Project config.json         (.agents-manager/config.json → agents section)
4. Hook params                 (from pipeline JSON: { "model": "claude-opus-4-6" })
5. Per-run overrides           (from UI "Run with options..." dialog)
```
- `agent_configs` table: global defaults only (NULL project_id). No per-project rows.
- `settings` table: UI preferences only (theme, window position, sidebar width, notification preferences)
- `config.json`: per-project agent config, checks, pipeline, git settings (version-controlled)

**B: Remove `agent_configs` table entirely**
- Global agent defaults go in `settings` table as JSON keys (e.g., `settings['agent.claude-code.model'] = 'claude-sonnet'`)
- Simpler DB schema (one fewer table)
- Less structured — settings becomes a grab-bag

**C: Remove `agent_configs` table, use a global `config.json`**
- Global defaults in `~/.agents-manager/config.json` (user home dir)
- Project overrides in `<project>/.agents-manager/config.json`
- No DB config at all — everything on disk
- More unix-y, fully version-controllable, but no UI for editing global defaults

**Decision: C — All config on disk via `config.json`.**
- Remove the `agent_configs` table entirely.
- Global defaults: `~/.agents-manager/config.json`
- Per-project overrides: `<project>/.agents-manager/config.json`
- `settings` table: UI preferences only (theme, window position, etc.)
- Config merge chain:
  1. Agent hardcoded defaults (`IAgent.getDefaultConfig()`)
  2. Global config file (`~/.agents-manager/config.json` → `agents` section)
  3. Project config file (`<project>/.agents-manager/config.json` → `agents` section)
  4. Hook params (from pipeline JSON)
  5. Per-run overrides (from UI)

---

## 2. AgentService vs WorkflowService Boundary

**The question:** Both `agent-platform.md` (AgentService) and `workflow-service.md` (WorkflowService) describe agent orchestration. What does each own?

**Recommended split:**

| Concern | Owner | Why |
|---------|-------|-----|
| `startAgent()` entry point | WorkflowService | Single entry point for all UIs |
| Create agent_run record | WorkflowService | It owns the run lifecycle |
| High-level event logging (agent.started) | WorkflowService | It owns notifications |
| Send notifications | WorkflowService | It owns the notification router |
| **Prepare environment** (worktree, deps) | AgentService | Execution detail |
| **Assemble context** (prompt building) | AgentService | Execution detail |
| **Execute agent** (spawn, stream, monitor) | AgentService | Execution detail |
| **Parse output** (outcome extraction) | AgentService | Execution detail |
| **Validate output** (schema + project checks) | AgentService | Execution detail |
| **Collect artifacts** (git, documents) | AgentService | Execution detail |
| Pipeline transition after completion | WorkflowService | It owns pipeline integration |
| Cleanup (unlock worktree, cost recording) | AgentService | Execution detail |

**Call flow:**
```
WorkflowService.startAgent(taskId, mode, config)
  → create run record
  → log agent.started event
  → send notification
  → agentService.execute(runId, task, project, mode, config)  // async, returns immediately
      → prepareEnvironment → assembleContext → executeAgent → parseOutput
      → validateOutput → collectArtifacts → cleanup
      → callback: workflowService.onAgentCompleted(runId, result)
  → return run
```

**Alternative: Merge into one class.** WorkflowService does everything. Simpler dependency graph but very long class.

**Decision: Recommended split confirmed.**
- WorkflowService: high-level lifecycle (entry point, run records, events, notifications, pipeline transitions).
- AgentService: execution details (worktree, prompt, spawn, parse, validate, artifacts, cleanup).

---

## 3. Error Handling Strategy

**The question:** No document defines what happens when things fail mid-operation. Need decisions on:

### 3a. Hook failure during transition

A transition has 3 hooks. Hook #2 throws. Task status already changed. What happens?

**Options:**
- **A (Recommended): Log error + continue remaining hooks.** The status change is committed. Failed hooks are recorded in the event log. Non-critical hooks (notify, log_activity) should never block a transition.
- **B: Rollback entire transition.** Undo the status change. Complex — need to undo hook #1's side effects too.
- **C: Categorize hooks as `critical` vs `non-critical`.** Critical hooks (start_agent, merge_pr) cause rollback. Non-critical hooks (notify, log_activity) log + continue.

### 3b. Artifact collection failure

Agent completed successfully, but artifact collection throws (e.g., git operations fail).

**Options:**
- **A (Recommended): Best-effort.** Log the failure, proceed with pipeline transition. Agent's work is still in the worktree — artifacts can be collected manually or re-tried.
- **B: Fail the run.** Treat collection failure as agent failure. Too harsh — the agent did its job.

### 3c. Notification channel failure

One of 3 notification channels throws during `broadcast()`.

**Options:**
- **A (Recommended): `Promise.allSettled()`.** Send to all channels in parallel, log failures, never block the operation. A broken Telegram bot should never prevent a task transition.

**Decisions:**
- **3a: A — Log error + continue remaining hooks.**
- **3b: A — Best-effort artifact collection.**
- **3c: A — `Promise.allSettled()` for notifications.**

---

## 4. Concurrency Model

**The question:** What prevents race conditions?

### 4a. Duplicate agent starts

Two users click "Start Agent" on the same task within milliseconds. The `no_running_agent` guard should prevent this, but: guard check and status update must be atomic.

**Options:**
- **A (Recommended): SQLite single-writer serialization.** Wrap `guard check + status update + run record creation` in a single SQLite transaction. SQLite's write lock ensures only one succeeds. The second attempt will see the updated status and fail the guard.
- **B: Optimistic locking.** Add a `version` column to tasks. Guard check reads version, transition writes with `WHERE version = ?`. If version changed, retry or fail.

### 4b. Supervisor cleanup race

Supervisor tries to delete a worktree while an agent is writing to it.

**Resolution:** Already handled — `worktreeManager.lock()/unlock()` prevents this. Supervisor's `cleanup()` skips locked worktrees.

### 4c. Concurrent CLI + UI updates

Two sources update the same task field simultaneously.

**Resolution:** Last-write-wins (SQLite default). For status changes, the pipeline engine enforces valid transitions so conflicting status updates are caught by guards.

**Decision: 4a: A — SQLite single-writer serialization.** Wrap guard check + status update + run record creation in one transaction.

---

## Summary

| # | Decision | Impact | Options |
|---|----------|--------|---------|
| 1 | agent_configs table role + config merge chain | DB schema, config loading code | A: 3-layer / B: settings table / C: all on disk |
| 2 | AgentService vs WorkflowService boundary | Code organization, dependency graph | Recommended split shown / Merge alternative |
| 3a | Hook failure behavior | Pipeline engine error handling | A: log+continue / B: rollback / C: critical/non-critical |
| 3b | Artifact collection failure | Agent completion flow | A: best-effort / B: fail run |
| 3c | Notification failure | Notification router | A: allSettled (clear winner) |
| 4a | Duplicate agent prevention | Transaction design | A: SQLite transaction / B: optimistic locking |
