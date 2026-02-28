---
summary: High-level architectural breakdown of the project into its major parts
key_points:
  - Nine high-level parts from UI layer down to framework infrastructure
  - WorkflowService is the single orchestration entry point
  - Two thin UI shells (Electron + CLI) share the same services and database
---

# Architecture Breakdown

A high-level decomposition of the project into its major parts.

```
┌─────────────┐  ┌──────────┐
│  Electron UI │  │   CLI    │   ← UI Layer (thin shells)
└──────┬───────┘  └────┬─────┘
       │    IPC / direct│
       └───────┬────────┘
               ▼
      ┌─────────────────┐
      │ WorkflowService │       ← Orchestration
      └────────┬────────┘
               │
    ┌──────────┼──────────────┐
    ▼          ▼              ▼
┌────────┐ ┌──────────┐ ┌─────────┐
│Pipeline│ │  Agent   │ │  SCM /  │
│ Engine │ │  System  │ │  Git    │
└────┬───┘ └────┬─────┘ └────┬────┘
     │          │             │
     ▼          ▼             ▼
┌──────────────────────────────────┐
│     Data Layer (SQLite Stores)   │
└──────────────────────────────────┘
         + Notifications / Telegram
```

---

## 1. UI Layer — Two Frontends

Both are thin UI shells with zero business logic.

### Electron Renderer (`src/renderer/`)

React app with ~20 pages (Dashboard, TaskList, KanbanBoard, Chat, AgentRun, SourceControl, Settings, etc.), hooks, and components. Communicates with the main process via `window.api` (the preload IPC bridge).

### CLI (`src/cli/`)

Commander.js tool (`npx agents-manager`) with commands for tasks, projects, pipelines, agents, prompts, events, status, and telegram. Directly instantiates services — no IPC needed.

Both share the same composition root (`createAppServices(db)`) and the same SQLite database file.

---

## 2. Orchestration / Business Logic

### WorkflowService (`src/main/services/workflow-service.ts`)

The single entry point for all business operations. Every IPC handler and CLI command delegates here. Covers task CRUD, state transitions, agent management, prompt handling, and reviews.

Interface: `src/main/interfaces/workflow-service.ts`

---

## 3. Pipeline Engine (State Machine)

### PipelineEngine (`src/main/services/pipeline-engine.ts`)

Drives task state transitions. Each transition has:

- **Triggers** — manual, agent, or system
- **Guards** — synchronous checks that block transitions
- **Hooks** — async side-effects that run after a successful transition

Two seeded pipelines: `AGENT_PIPELINE` (full agent workflow) and `SIMPLE_PIPELINE` (basic status flow).

---

## 4. Agent System

The AI execution layer.

### Agent Framework (`src/main/agents/`)

`Agent` class combines a **PromptBuilder** (what to say) with an **AgentLib** (how to execute it).

Prompt builders (role-based):
- `PlannerPromptBuilder` — plan creation and revision
- `DesignerPromptBuilder` — technical design creation and revision
- `ImplementorPromptBuilder` — implementation, request changes, conflict resolution
- `InvestigatorPromptBuilder` — bug investigation
- `ReviewerPromptBuilder` — code review workflow
- `TaskWorkflowReviewerPromptBuilder` — task workflow review

### Agent Libs / Engines (`src/main/libs/`)

Pluggable execution backends registered in `AgentLibRegistry` and resolved at runtime via config:

- `ClaudeCodeLib`
- `CursorAgentLib`
- `CodexCliLib`

### Agent Services (`src/main/services/`)

- `agent-service.ts` — orchestrates agent runs
- `agent-supervisor.ts` — supervises agent execution
- `chat-agent-service.ts` — handles chat-based agent interactions

---

## 5. Data Layer

### SQLite Stores (`src/main/stores/`)

~16 stores covering all persistent data:

- Tasks, projects, pipelines, features
- Agent definitions, agent runs
- Chat sessions, chat messages
- Kanban boards
- Activity logs, event logs
- Task artifacts, task phases, task context
- Pending prompts, users

### Migrations (`src/main/migrations.ts`)

Additive-only schema migrations that run at startup. DB path resolves from `--db` flag, `AM_DB_PATH` env, or the default app data location.

---

## 6. SCM / Git Integration

### Worktree Manager (`src/main/services/local-worktree-manager.ts`)

Manages git worktrees for isolated agent execution. Interface: `src/main/interfaces/worktree-manager.ts`.

### Git Ops (`src/main/services/local-git-ops.ts`)

Low-level git operations (branch creation, commits, diffs).

### SCM Platform (`src/main/services/github-scm-platform.ts`)

GitHub integration — PR creation via `gh` CLI. Branch naming follows `task/<id>/<slug>` convention.

---

## 7. Notifications & External Integrations

### Notification Router

Multi-channel notification system composed via `MultiChannelNotificationRouter`:

- `DesktopNotificationRouter` — OS-level notifications
- `ElectronNotificationRouter` — in-app notifications
- `TelegramNotificationRouter` — Telegram bot notifications

### Telegram Bot (`src/main/services/telegram-bot-service.ts`)

Bot integration for remote notifications and control.

---

## 8. Shared / Cross-cutting

### Shared Types & Utils (`src/shared/`)

- `ipc-channels.ts` — 57+ IPC channel definitions
- `types.ts` — shared type definitions
- `cost-utils.ts`, `phase-utils.ts`, `agent-message-utils.ts`

### Interfaces (`src/main/interfaces/`)

~28 interface files defining contracts between all parts (stores, services, agents, libs). This is the dependency-inversion seam that allows stubs for testing.

### IPC Bridge (`src/preload/`, `src/main/ipc-handlers.ts`, `src/main/handlers/`)

Electron IPC plumbing connecting the renderer to services. Streaming uses an `onMessage` callback pattern for live agent output.

---

## 9. Framework / Template Infrastructure

### Template (`template/`)

Electron boilerplate — main process bootstrap, preload scripts, renderer shell. Treated as read-only infrastructure. All customization goes in `src/`.
