---
summary: High-level architectural breakdown of the project into its major parts
key_points:
  - Nine high-level parts from UI layer down to framework infrastructure
  - Daemon owns business logic, SQLite, REST API, and WebSocket push events
  - Electron and CLI are thin clients that talk to the daemon through src/client/
---

# Architecture Breakdown

A high-level decomposition of the project into its major parts.

```
┌─────────────────────────────────────────────────────────┐
│  Daemon Process (src/daemon/)                           │
│  ┌────────────────────────────────────────────────┐     │
│  │  WorkflowService + core services (src/core/)   │     │
│  │  Pipeline engine, agents, SCM, notifications   │     │
│  │  SQLite DB (sole owner)                        │     │
│  └────────────────────────────────────────────────┘     │
│  REST API (Express)  +  WebSocket push events           │
└──────────────────────────┬──────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │ API Client       │ API Client       │
        │ (src/client/)    │ (src/client/)    │
┌───────┴────────┐  ┌──────┴────────┐
│ Electron Main  │  │ CLI           │   ← thin clients
│ src/main/      │  │ src/cli/      │
│ IPC → API      │  │ Commander→API │
│ WS → Renderer  │  │               │
└───────┬────────┘  └───────────────┘
        │ IPC
┌───────┴────────┐
│ Renderer       │
│ src/renderer/  │
│ React UI       │
└────────────────┘
```

---

## 1. Client Layer — Electron, CLI, Renderer

All client-side entry points are thin shells with zero business logic.

### Electron Renderer (`src/renderer/`)

React app with ~20 pages (Dashboard, TaskList, KanbanBoard, Chat, AgentRun, SourceControl, Settings, etc.), hooks, and components. Communicates with the main process via `window.api` (the preload IPC bridge).

### Electron Main (`src/main/`)

Thin desktop shell. It auto-starts the daemon, creates an API client, registers IPC handlers that delegate to that client, and forwards daemon WebSocket events to the renderer.

### CLI (`src/cli/`)

Commander.js tool (`npx agents-manager`) with commands for tasks, projects, pipelines, agents, prompts, events, status, and telegram. It auto-starts the daemon and delegates all API-backed commands to the typed HTTP client in `src/client/`.

### Shared Client API (`src/client/`)

Typed HTTP and WebSocket clients shared by Electron and CLI. This is the transport seam between thin clients and the daemon.

---

## 2. Daemon Layer

### Daemon Process (`src/daemon/`)

The daemon owns the database, runs all business services, hosts the REST API, and emits WebSocket events for streaming and push notifications. It is the only process that instantiates `createAppServices(db)`.

---

## 3. Orchestration / Business Logic

### WorkflowService (`src/core/services/workflow-service.ts`)

The single entry point for core business operations. Daemon routes delegate here for task CRUD, state transitions, agent management, prompt handling, and merge flows.

### PipelineInspectionService (`src/core/services/pipeline-inspection-service.ts`)

Read-heavy operational service for pipeline diagnostics, failed-hook retry, phase advancement, and event dismissal.

Interfaces:
- `src/core/interfaces/workflow-service.ts`
- `src/core/interfaces/pipeline-inspection-service.ts`

---

## 4. Pipeline Engine (State Machine)

### PipelineEngine (`src/core/services/pipeline-engine.ts`)

Drives task state transitions. Each transition has:

- **Triggers** — manual, agent, or system
- **Guards** — synchronous checks that block transitions
- **Hooks** — async side-effects that run after a successful transition

One seeded pipeline: `AGENT_PIPELINE` (the unified investigation → design → plan → implement → review workflow).

---

## 5. Agent System

The AI execution layer.

### Agent Framework (`src/core/agents/`)

`Agent` class combines a **PromptBuilder** (what to say) with an **AgentLib** (how to execute it).

Prompt builders (role-based):
- `PlannerPromptBuilder` — plan creation and revision
- `DesignerPromptBuilder` — technical design creation and revision
- `ImplementorPromptBuilder` — implementation, request changes, conflict resolution
- `InvestigatorPromptBuilder` — bug investigation
- `ReviewerPromptBuilder` — code review workflow
- `TaskWorkflowReviewerPromptBuilder` — task workflow review

### Agent Libs / Engines (`src/core/libs/`)

Pluggable execution backends registered in `AgentLibRegistry` and resolved at runtime via config:

- `ClaudeCodeLib`
- `CursorAgentLib`
- `CodexCliLib`
- `CodexAppServerLib`

### Agent Services (`src/core/services/`)

- `agent-service.ts` — orchestrates agent runs
- `agent-supervisor.ts` — supervises agent execution
- `chat-agent-service.ts` — handles chat-based agent interactions (orchestration, session CRUD, injection)
- `chat-agent/agent-runner.ts` — streaming agent execution engine (extracted from chat-agent-service)
- `chat-agent/chat-agent-helpers.ts` — shared constants, types, and utility functions
- `chat-agent/chat-conversation-utils.ts` — summarization and auto-naming utilities

---

## 6. Data Layer

### SQLite Stores (`src/core/stores/`)

Persistent stores cover tasks, projects, pipelines, features, agent definitions, agent runs, chat, kanban, notifications, items, prompts, task context, phases, artifacts, and logs.

### Migrations (`src/core/migrations.ts`)

Additive-only schema migrations that run at startup. DB path resolves from an explicit `dbPath` option, `AM_DB_PATH`, or the default app data location.

---

## 7. SCM / Git Integration

### Worktree Manager (`src/core/services/local-worktree-manager.ts`)

Manages git worktrees for isolated agent execution. Interface: `src/core/interfaces/worktree-manager.ts`.

### Git Ops (`src/core/services/local-git-ops.ts`)

Low-level git operations (branch creation, commits, diffs).

### SCM Platform (`src/core/services/github-scm-platform.ts`)

GitHub integration — PR creation via `gh` CLI. Branch naming follows `task/<id>/<slug>` convention.

---

## 8. Notifications & External Integrations

### Notification Router

Multi-channel notification system composed via `MultiChannelNotificationRouter`:

- `InAppNotificationRouter` — persisted in-app notifications + push event
- `TelegramNotificationRouter` — Telegram bot notifications

### Telegram Bot (`src/core/services/telegram-bot-manager.ts`)

Bot lifecycle and remote-control integration running inside the daemon.

---

## 9. Shared / Cross-cutting

### Shared Types & Utils (`src/shared/`)

- `ipc-channels.ts` — IPC channel definitions for Electron
- `types.ts` — shared type definitions
- `cost-utils.ts`, `phase-utils.ts`, `agent-message-utils.ts`

### Interfaces (`src/core/interfaces/`)

~28 interface files defining contracts between all parts (stores, services, agents, libs). This is the dependency-inversion seam that allows stubs for testing.

### IPC Bridge (`src/preload/`, `src/main/ipc-handlers/`)

Electron IPC plumbing connecting the renderer to the API-backed Electron main process.

---

### Template (`template/`)

Electron boilerplate — main process bootstrap, preload scripts, renderer shell. Treated as read-only infrastructure. All customization goes in `src/`.
