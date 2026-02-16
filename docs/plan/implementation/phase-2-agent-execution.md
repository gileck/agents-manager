# Phase 2: Agent Execution — Run Agents, Stream Output

> Run Claude Code on tasks. Plan-only and implement modes. Stream agent output in real time. Git worktree isolation. Artifact collection.

## Depends on: Phase 1 complete

---

## 2.1 — Agent Framework + Registry
**Vertical slice:** Agent types can be registered and discovered.

- [ ] `IAgent` interface (execute, stop, isAvailable)
- [ ] `IAgentFramework` interface (register, get, list, getAvailable)
- [ ] `AgentFramework` implementation with agent registry
- [ ] `AgentMode` type: plan | implement | review
- [ ] Agent availability check (is CLI installed?)

**Arch docs:** `architecture/agent-platform.md` (Agent Interface)

---

## 2.2 — Agent Run Store + DB Tables
**Vertical slice:** Agent executions are persisted and queryable.

- [ ] `agent_runs` table (taskId, agentType, mode, status, output, outcome, payload, exitCode, timestamps, token costs)
- [ ] `task_artifacts` table (taskId, type, data JSON, timestamps)
- [ ] `task_phases` table (taskId, phase, status, agentRunId, timestamps)
- [ ] `pending_prompts` table (taskId, promptType, payload, response, status, timestamps)
- [ ] `IAgentRunStore` interface + `SqliteAgentRunStore`
- [ ] `ITaskArtifactStore` interface + `SqliteTaskArtifactStore`
- [ ] `ITaskPhaseStore` interface + `SqliteTaskPhaseStore`
- [ ] `IPendingPromptStore` interface + `SqlitePendingPromptStore`

**Arch docs:** `architecture/database.md` (Agent tables), `architecture/agent-platform.md`

---

## 2.3 — Claude Code Agent
**Vertical slice:** Can execute Claude Code SDK against a task and capture output.

- [ ] `ClaudeCodeAgent` implementation using `@anthropic-ai/claude-code`
- [ ] Prompt assembly from task metadata (title, description, plan)
- [ ] Mode-specific prompts (plan vs implement vs review)
- [ ] Output capture (streaming transcript)
- [ ] Token/cost tracking from SDK response
- [ ] Exit code handling
- [ ] Stop/cancel support

**Arch docs:** `architecture/agent-platform.md` (Claude Code Agent)

---

## 2.4 — Git Ops (Real Implementation)
**Vertical slice:** App can create branches, commit, push, diff via git CLI.

- [ ] `LocalGitOps` implementation using child_process + git CLI
- [ ] PATH resolution for macOS GUI apps (nvm, fnm, Homebrew)
- [ ] Branch operations (create, checkout, list, delete)
- [ ] Commit and push
- [ ] Diff and status
- [ ] Log parsing
- [ ] Replace `StubGitOps`

**Arch docs:** `architecture/git-scm.md` (IGitOps)

---

## 2.5 — Worktree Manager (Real Implementation)
**Vertical slice:** Agents work in isolated worktrees, not the main checkout.

- [ ] `LocalWorktreeManager` implementation
- [ ] Create worktree with branch in `.agent-worktrees/`
- [ ] Lock/unlock worktree (prevent concurrent agent access)
- [ ] Cleanup finished worktrees
- [ ] Auto-add `.agent-worktrees/` to `.gitignore`
- [ ] Replace `StubWorktreeManager`

**Arch docs:** `architecture/git-scm.md` (IWorktreeManager)

---

## 2.6 — SCM Platform / GitHub (Real Implementation)
**Vertical slice:** App can create and manage PRs via `gh` CLI.

- [ ] `GitHubPlatform` implementation using `gh` CLI
- [ ] Create PR (title, body, head, base, draft)
- [ ] Get PR status
- [ ] Merge PR
- [ ] Auth check (`gh auth status`)
- [ ] Replace `StubScmPlatform`

**Arch docs:** `architecture/git-scm.md` (IScmPlatform)

---

## 2.7 — Agent Service (Orchestration)
**Vertical slice:** Full agent lifecycle — prepare, execute, collect artifacts, transition.

- [ ] `AgentService` implementation (the 10-step pipeline):
  1. Prepare environment (create worktree)
  2. Assemble context (build prompt from task + events + artifacts)
  3. Configure agent (merge config hierarchy)
  4. Execute agent (run via IAgent)
  5. Monitor execution (timeout, cancellation)
  6. Parse output (extract structured outcome)
  7. Validate output (optional project checks)
  8. Collect artifacts (branches, commits, PRs, diffs)
  9. Trigger pipeline (execute transition based on outcome)
  10. Cleanup (unlock worktree, log completion)
- [ ] `AgentContextBuilder` — assembles prompt from task metadata, plan, event history, artifacts
- [ ] Outcome parsing from agent transcript (`<<<OUTCOME:...>>>` markers)
- [ ] Agent run status updates (running → completed/failed/timed_out/cancelled)

**Arch docs:** `architecture/agent-platform.md` (10-Step Pipeline)

---

## 2.8 — Pipeline Handlers (Guards + Hooks)
**Vertical slice:** Pipeline transitions can check preconditions and trigger side effects.

- [ ] Handler plugin interface
- [ ] `CoreHandler` — guards: `has_plan`, `has_branch`, `dependencies_resolved`, `no_running_agent`
- [ ] `AgentHandler` — hooks: `start_agent` (auto-start agent on transition)
- [ ] `GitHandler` — hooks: `create_branch` (auto-create branch on transition)
- [ ] `NotificationHandler` — hooks: `notify` (send notification on transition)
- [ ] `ActivityHandler` — hooks: `log_activity`
- [ ] Register handlers in pipeline engine
- [ ] Agent-Driven pipeline (seeded) that uses hooks to auto-start agents

**Arch docs:** `architecture/pipeline/engine.md` (Guards & Hooks), `architecture/pipeline/json-contract.md`

---

## 2.9 — Outcome System
**Vertical slice:** Agent outputs drive pipeline transitions automatically.

- [ ] `OUTCOME_SCHEMAS` registry mapping outcome names → JSON Schema
- [ ] Built-in outcomes: `plan_complete`, `pr_ready`, `needs_info`, `changes_requested`, `task_split_proposed`, `review_approved`, `failed`
- [ ] Outcome validation against schema
- [ ] Outcome → transition mapping in pipeline definition
- [ ] Payload storage in `pending_prompts` for human-in-the-loop outcomes

**Arch docs:** `architecture/pipeline/outcome-schemas.md`

---

## 2.10 — WorkflowService: Agent Operations
**Vertical slice:** WorkflowService exposes agent start/stop/list via single API.

- [ ] `startAgent(taskId, mode, agentType)` — delegates to AgentService
- [ ] `stopAgent(runId)` — cancels running agent
- [ ] `respondToPrompt(promptId, response)` — answers human-in-the-loop prompt
- [ ] `mergePR(taskId)` — reads PR artifact, merges via SCM, transitions to Done
- [ ] Agent-related event logging
- [ ] Wire into IPC handlers

**Arch docs:** `architecture/workflow-service.md` (Agent Operations)

---

## 2.11 — IPC Handlers + Preload (Agent)
**Vertical slice:** Renderer can start/stop agents and view runs.

- [ ] `agent:start` — start agent on task
- [ ] `agent:stop` — stop running agent
- [ ] `agent:runs` — list agent runs (by task or project)
- [ ] `agent:get` — get single agent run with transcript
- [ ] `prompts:list` — list pending prompts
- [ ] `prompts:respond` — respond to prompt
- [ ] `artifacts:list` — list artifacts for task
- [ ] Agent output streaming via IPC events
- [ ] Preload API additions

**Arch docs:** `architecture/app-ui.md` (IPC)

---

## 2.12 — Agent Runs UI
**Vertical slice:** User can see agent execution history and live output.

- [ ] Agent runs list page (`/projects/:id/agents`)
- [ ] Agent run detail page (`/projects/:id/agents/:runId`)
- [ ] Streaming transcript viewer (auto-scroll, syntax highlighting)
- [ ] Status indicator (running spinner, completed check, failed X)
- [ ] Cost display (input/output tokens)
- [ ] Stop button for running agents
- [ ] `useAgentRuns()` and `useAgentRun()` hooks

**Arch docs:** `architecture/app-ui.md` (Agent Pages)

---

## 2.13 — Task Detail: Agent Integration
**Vertical slice:** Task detail page shows agent controls and artifacts.

- [ ] "Run Agent" button on task detail (select mode: plan/implement/review)
- [ ] Agent Runs tab showing run history for this task
- [ ] Artifacts tab showing branches, PRs, commits, diffs, documents
- [ ] Pending prompts section (if agent is waiting for input)
- [ ] Prompt response form (text input, option selection)
- [ ] Plan viewer (rendered markdown from plan artifact)

**Arch docs:** `architecture/app-ui.md` (Task Detail), `architecture/pipeline/ui.md`

---

## 2.14 — Desktop Notifications (Basic)
**Vertical slice:** User gets macOS notifications for key events.

- [ ] `DesktopNotificationChannel` using Electron Notification API
- [ ] `INotificationRouter` with single desktop channel
- [ ] Notify on: agent completed, agent failed, prompt waiting
- [ ] Replace `StubNotificationRouter`

**Arch docs:** `architecture/notification-system.md` (Desktop)

---

## 2.15 — Scripted Agent (Testing)
**Vertical slice:** A mock agent for testing the full pipeline without real Claude.

- [ ] `ScriptedAgent` with predefined scripts
- [ ] Scripts: `happyPlan`, `happyImplement`, `happyReview`, `failAfterSteps`, `humanInTheLoop`, `noop`
- [ ] Useful for E2E tests and demos

**Arch docs:** `architecture/testkit.md` (Scripted Agent)

---

## Phase 2 Acceptance Criteria
- Can start Claude Code agent on a task in plan or implement mode
- Agent runs in isolated worktree
- Live streaming of agent output in UI
- Agent completion auto-transitions task (e.g., planning → planned)
- Artifacts (branches, PRs, commits) auto-collected and visible
- Human-in-the-loop: agent can pause, user responds, agent context includes response
- Pipeline guards work (e.g., can't implement without a plan)
- Desktop notifications fire on agent events
- Cost tracking per run
