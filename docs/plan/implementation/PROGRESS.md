# Implementation Progress

> Check off tasks as they are completed. Each task references its phase file for details.
>
> Legend: `[x]` = done, `[~]` = partial (backend done, UI missing or stubs remain), `[ ]` = not started

## Phase 1: Foundation
- [x] 1.1 Scaffold: routing, layout, sidebar, empty pages
- [x] 1.2 Database schema + migrations (core tables) — all 18 migrations exist, includes Phase 2 tables too
- [x] 1.3 Interfaces + SQLite stores (core) — all interfaces + SQLite implementations
- [x] 1.4 Pipeline engine (basic) — PipelineEngine with guard/hook framework, 4 seeded pipelines
- [x] 1.5 WorkflowService (Phase 1 scope) — full implementation with activity/event logging
- [x] 1.6 IPC handlers + preload API — 50+ handlers, full preload API
- [x] 1.7 Projects page (CRUD) — ProjectsPage with cards, create dialog
- [x] 1.8 Task list page (CRUD + filters) — TaskListPage with filters, create dialog, multi-select bulk delete
- [x] 1.9 Task detail page — 5 tabs (Overview, Transitions, Events, Artifacts, Agent Runs)
- [ ] 1.10 Kanban board — **NOT BUILT**: no drag-and-drop board, only task list view exists
- [x] 1.11 Settings page — SettingsPage exists
- [~] 1.12 Task dependencies — DB table + store + IPC exist, but **no dependency UI** in task detail
- [~] 1.13 Subtasks (parent-child) — parentTaskId field in DB/model, but **no subtask UI**

## Phase 2: Agent Execution
- [x] 2.1 Agent framework + registry — IAgent, IAgentFramework, AgentFrameworkImpl
- [x] 2.2 Agent run store + DB tables — all 4 tables + stores + interfaces
- [x] 2.3 Claude Code agent — ClaudeCodeAgent with SDK integration, streaming output, mode-specific prompts
- [x] 2.4 Git ops (real implementation) — `LocalGitOps` using child_process + git CLI with PATH resolution
- [x] 2.5 Worktree manager (real implementation) — `LocalWorktreeManager` with create/lock/unlock/cleanup
- [x] 2.6 SCM platform / GitHub (real implementation) — `GitHubScmPlatform` using `gh` CLI for PR create/status/merge
- [x] 2.7 Agent service (orchestration) — AgentService with worktree isolation, artifact collection, auto-transition
- [x] 2.8 Pipeline handlers (guards + hooks) — `core-guards.ts` (has_pr, dependencies_resolved, no_running_agent), `agent-handler.ts` (start_agent), `notification-handler.ts` (notify)
- [x] 2.9 Outcome system — `outcome-schemas.ts` registry with 9 outcomes (3 with payload schemas, 6 signal-only), structural validation in agent-service (warn-and-proceed)
- [x] 2.10 WorkflowService: agent operations — startAgent, stopAgent, respondToPrompt, mergePR
- [x] 2.11 IPC handlers + preload (agent) — all agent/prompt/artifact IPC handlers
- [x] 2.12 Agent runs UI — AgentRunPage with status, mode, timestamps, outcome, output
- [x] 2.13 Task detail: agent integration — Agent Runs tab, Artifacts tab in TaskDetailPage
- [x] 2.14 Desktop notifications (basic) — `DesktopNotificationRouter` using Electron Notification API, click-to-navigate, notify hooks on agent pipeline transitions
- [x] 2.15 Scripted agent (testing) — ScriptedAgent with happyPlan, happyImplement, etc.

## Phase 3: CLI + Multi-Agent
- [x] 3.1 CLI scaffold + DB access — am CLI, commander.js, db.ts, output formatting
- [x] 3.2 CLI: project commands — list, get, create, update, delete
- [x] 3.3 CLI: task commands — list, get, create, update, delete, transition, transitions, start
- [x] 3.4 CLI: agent commands — start, stop, runs, get
- [x] 3.5 CLI: supporting commands — events, prompts, pipelines, deps, status
- [ ] 3.6 Multi-agent: Cursor — **NOT BUILT**
- [ ] 3.7 Multi-agent: Aider — **NOT BUILT**
- [ ] 3.8 Multi-agent: custom agent (generic CLI wrapper) — **NOT BUILT**
- [ ] 3.9 Agent configuration system — **NOT BUILT**: no config file hierarchy
- [ ] 3.10 Task supervisor (background health loop) — **NOT BUILT**
- [ ] 3.11 ProjectValidator (build/lint/test checks) — **NOT BUILT**

## Phase 4: Dashboard + Polish
- [~] 4.1 Dashboard page (stats + overview) — basic DashboardPage exists with stats cards, but **no charts, no activity feed**
- [ ] 4.2 Cost tracking dashboard
- [ ] 4.3 Activity feed (full page)
- [ ] 4.4 Notification channels: Telegram
- [ ] 4.5 Notification channels: Slack
- [ ] 4.6 Notification channels: webhook
- [ ] 4.7 Notification preferences UI
- [ ] 4.8 Bulk operations
- [ ] 4.9 Workflow visualizer
- [ ] 4.10 Pipeline editor

## Phase 5: Advanced
- [ ] 5.1 Task templates
- [ ] 5.2 GitHub issues import
- [ ] 5.3 Agent queue
- [ ] 5.4 Inline diff review
- [ ] 5.5 Task notes (append-only commentary)
- [ ] 5.6 Advanced pipeline features

---

## Summary

| Phase | Done | Partial | Not Started | Total |
|-------|------|---------|-------------|-------|
| 1. Foundation | 9 | 2 | 1 | 13 |
| 2. Agent Execution | **15** | 0 | 0 | 15 |
| 3. CLI + Multi-Agent | 5 | 0 | 6 | 11 |
| 4. Dashboard + Polish | 0 | 1 | 9 | 10 |
| 5. Advanced | 0 | 0 | 6 | 6 |
| **Total** | **29** | **3** | **22** | **55** |

## What to Build Next (Remaining by Priority)

### Medium priority — polish existing features
1. **1.12** Task dependencies UI — backend exists, just needs UI
2. **1.13** Subtasks UI — backend exists, just needs UI
3. **3.9** Agent configuration system — config file hierarchy
4. **3.10** Task supervisor — background health monitoring
5. **3.11** ProjectValidator — post-agent validation

### Lower priority — new capabilities
6. **1.10** Kanban board — drag-and-drop board view
7. **3.6–3.8** Multi-agent support (Cursor, Aider, Custom)
8. **4.1–4.10** Dashboard polish, notifications, bulk ops, visualizer
9. **5.1–5.6** Templates, GitHub import, queue, diff review

## Notes on Plan vs Implementation Deviations

### 2.7 — AgentService simplifications
- **AgentContextBuilder** not built as a separate class; prompt assembly is inline in ClaudeCodeAgent
- **`<<<OUTCOME:...>>>` markers** not needed; outcomes come directly from Claude Code SDK response
- These were intentional simplifications — the SDK handles what the plan expected to be manual

### 2.8 — Pipeline handlers scope
- Plan called for `GitHandler` (create_branch hook), `ActivityHandler` (log_activity hook), and `has_plan`/`has_branch` guards
- These were not built — the current guards (`has_pr`, `dependencies_resolved`, `no_running_agent`) and hooks (`start_agent`, `notify`) cover the active pipeline definitions
- Additional handlers can be added when pipelines need them

### 2.9 — Outcome system scope
- Plan listed `task_split_proposed`, `review_approved`, `failed` as built-in outcomes — these are not in the registry
- Registry has 9 outcomes covering current pipeline needs; more can be added as workflows expand
