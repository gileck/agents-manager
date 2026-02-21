# Agents Manager - Project Plan Overview

## Vision

A macOS desktop app for managing AI coding agents working on your projects. It combines a task manager (kanban board, priorities, statuses) with agent orchestration (run Claude Code, Cursor, Aider, etc. on tasks, stream output, track results).

## Tech Stack

- **Electron 40** - desktop app framework
- **React 19 + TypeScript** - UI
- **Tailwind CSS** - styling
- **better-sqlite3** - local database
- **Node.js child_process** - agent execution

## Phase Roadmap

| Phase | Name | Summary | Depends On |
|-------|------|---------|------------|
| 1 | Foundation | Task CRUD, kanban board, project management. A working task tracker with no agent integration. | - |
| 2 | Agent Execution | Run Claude Code SDK on tasks. Plan-only and implement modes. Stream agent output in real time. | Phase 1 |
| 3 | Agent CLI + Multi-Agent | CLI tool (`am`) with direct DB access so agents can read/update tasks. Support for Cursor CLI, Aider, custom agents. | Phase 2 |
| 4 | Dashboard + Polish | Dashboard with stats/charts, activity feed, cost tracking, desktop notifications, bulk operations. | Phase 3 |
| 5 | Advanced | Task templates, GitHub issues import, agent queue, inline diff review. | Phase 4 |

## Core Entities

### Project
A local codebase/repo. Each project has its own tasks and agent history.

### Task
A unit of work. Has title, description, priority, size, complexity, status, tags, plan, dependencies, and links to agent runs.

### Agent Run
A single execution of an agent against a task. Has type (Claude, Cursor, etc.), mode (plan/implement), status, transcript, cost, timestamps.

## Task Pipeline

Task statuses are **not hardcoded** - they're defined by a dynamic pipeline (state machine). Pipelines are JSON configurations with statuses, transitions, guards, and hooks. See **`architecture/pipeline/index.md`** for full details.

Starts simple:
```
Open → In Progress → Done
```

Grows to:
```
Open → Planning → Planned → In Progress → PR Review → Done
                                              ↓
                                     Changes Requested → (back to In Progress)
```

Different task types can have different pipelines. Agents trigger transitions. Transitions trigger agents. All extensible via config, not code.

## Pages

| Page | Route | Phase |
|------|-------|-------|
| Dashboard | `/` | 4 |
| Projects | `/projects` | 1 |
| Task Board | `/projects/:id/board` | 1 |
| Task List | `/projects/:id/tasks` | 1 |
| Task Detail | `/projects/:id/tasks/:taskId` | 1 |
| New/Edit Task | `/projects/:id/tasks/new`, `/projects/:id/tasks/:taskId/edit` | 1 |
| Agent Runs | `/projects/:id/agents` | 2 |
| Agent Run Detail | `/projects/:id/agents/:runId` | 2 |
| Workflow Visualizer | `/projects/:id/workflow` | 4 |
| Settings | `/settings` | 1 |

## Critical Architecture Principles

### 1. Interface-First + Async Everywhere
**Every external dependency is accessed through an interface.** All methods return `Promise`. This allows swapping any layer (including moving to cloud) without refactoring.

### 2. Workflow Service = Single Source of Logic
**All business logic lives in the Workflow Service.** The three UIs (Electron app, notification channels, CLI) are display + input only. They call the same Workflow Service methods and produce identical behavior. See **`architecture/workflow-service.md`**.

### 3. Bidirectional Notifications
**Notification channels are full UIs**, not just alerts. Admins can take actions (answer questions, approve PRs, pick options) directly from Telegram/Slack. See **`architecture/notification-system.md`**.

### 4. Workflow-Only PR Merge
**PRs are merged exclusively through the Workflow Service** — triggered from any of the 3 UIs (Electron app, Telegram/Slack, CLI). This keeps the Workflow Service as the single source of truth for task lifecycle. See **`architecture/overview.md`** for details.

### 5. Task Artifacts
**Tasks accumulate artifacts** (branches, PRs, commits, links) as first-class data. The Merge button reads the PR artifact, merges it, and auto-transitions to Done. See **`architecture/overview.md`**.

### 6. Agent Context Assembly
**All task communication is stored in the event log** — like a GitHub issue thread. When an agent resumes after a pause, the `AgentContextBuilder` assembles the full context from task metadata, plan, event history, and payload responses.

See **`architecture/overview.md`** for full details.

### Abstraction Layers

| Interface | Phase 1 Implementation | Future Swap Examples |
|-----------|----------------------|---------------------|
| `ITaskStore` | SQLite | Linear, Jira, GitHub Projects, Notion |
| `IProjectStore` | SQLite | Config file, remote service |
| `IAgentFramework` / `IAgent` | Claude Code SDK | Cursor, Aider, Codex, custom |
| `IGitOps` | Local git CLI | libgit2, remote git service |
| `IScmPlatform` | GitHub (gh CLI) | GitLab, Bitbucket |
| `INotifier` | Electron desktop | Slack, email, webhooks |
| `IActivityLog` | SQLite | External analytics service |
| `IStorage` | SQLite | S3, cloud storage |

All providers are registered in a single `providers/setup.ts` file. Swapping an implementation is a one-line change there.

## Doc Structure

- `overview.md` - this file
- `architecture/` - all architecture & design docs:
  - `architecture/overview.md` - abstraction layers, interfaces, dependency injection, async-everywhere rule
  - `architecture/app-ui.md` - Electron React UI, pages/routes, layout, components, hooks, IPC, styling
  - `architecture/workflow-service.md` - the single source of logic, UI adapter pattern
  - `architecture/workflow-cli.md` - CLI tool, HTTP API, CLI-first development strategy
  - `architecture/tasks.md` - task data model, ITaskStore interface, filters, dependencies, artifacts, plan
  - `architecture/projects.md` - project data model, IProjectStore interface, path management, project config
  - `architecture/agent-platform.md` - agent execution lifecycle (10-step pipeline)
  - `architecture/notification-system.md` - bidirectional notification channels (desktop, Telegram, Slack)
  - `architecture/git-scm.md` - IGitOps, IWorktreeManager, IScmPlatform interfaces, PR lifecycle, branching
  - `architecture/pipeline-features.md` - advanced pipeline flows: request info, review, task splitting
  - `architecture/database.md` - SQLite schema, migrations, indexes, JSON storage, ER diagram
  - `architecture/testkit.md` - E2E testing infrastructure, mock implementations, scripted agents
  - `architecture/gaps-and-open-questions.md` - architecture review: contradictions, missing specs, open questions
  - `architecture/pipeline/` - dynamic task pipeline (state machine):
    - `architecture/pipeline/index.md` - overview, three layers
    - `architecture/pipeline/engine.md` - core engine, transition execution, agent integration
    - `architecture/pipeline/json-contract.md` - data model, JSON format, handlers, built-in pipelines
    - `architecture/pipeline/outcome-schemas.md` - outcome registry, payloads, human-in-the-loop
    - `architecture/pipeline/event-log.md` - task event log
    - `architecture/pipeline/errors.md` - failed agents, retry, supervisor, concurrency
    - `architecture/pipeline/ui.md` - kanban, workflow visualizer, React hooks, IPC
- `implementation/` - phase implementation plans:
  - `implementation/phase-1-foundation.md` - task manager, projects, board
  - `implementation/phase-2-agent-execution.md` - run agents, stream output
  - `implementation/phase-3-agent-cli-multi-agent.md` - CLI tool, multi-agent support
  - `implementation/phase-4-dashboard-polish.md` - dashboard, notifications, bulk ops
  - `implementation/phase-5-advanced.md` - templates, import, queue, diff review
