# Agents Manager — Claude Code Notes

This file provides Claude with context about the codebase. It is auto-generated from `docs/` files.
Run `yarn build:claude` to regenerate.


## Architecture Overview

System architecture, composition root, and the single-execution-engine principle

**Summary:** Three-tier daemon architecture: daemon (src/core/ services + SQLite), Electron (thin IPC→API client shell), CLI (thin Commander→API client shell). All business logic lives in src/core/services/ (WorkflowService). The daemon is the sole DB owner.

**Key Points:**
- NEVER add business logic to the renderer, CLI, or IPC handlers — all logic goes in WorkflowService (src/core/services/)
- src/ is application code; template/ is framework infrastructure (DO NOT MODIFY)
- Daemon (src/daemon/) is the sole DB owner; Electron and CLI connect via HTTP/WS API client (src/client/)

**Docs:** [architecture-overview.md](docs/architecture-overview.md)

---

## Development Guide

Package manager, commands, deployment, dev tips, app behavior, assets, and key files

**Guidelines:**
- ALWAYS use `yarn` as the package manager — NEVER use `npm`
- ALWAYS run `yarn checks` after modifying code (TypeScript + ESLint)
- Never modify files in `template/` — all customization goes in `src/`

**Full docs:** [development-guide.md](docs/development-guide.md)

---

## Agent System

Agent types, execution lifecycle, prompts, validation, and context accumulation

**Summary:** Agent architecture: Agent class combines a PromptBuilder (domain logic) with an AgentLib (engine logic) resolved from AgentLibRegistry. Role-based prompt builders: PlannerPromptBuilder, DesignerPromptBuilder, ImplementorPromptBuilder, InvestigatorPromptBuilder, ReviewerPromptBuilder. ScriptedAgent is the test mock.

**Key Points:**
- File: src/core/agents/ — Agent, PlannerPromptBuilder, DesignerPromptBuilder, ImplementorPromptBuilder, InvestigatorPromptBuilder, ReviewerPromptBuilder, ScriptedAgent
- File: src/core/libs/ — ClaudeCodeLib, CursorAgentLib, CodexCliLib
- Agent resolves AgentLib from registry via config.engine at execute() time
- Prompt templates: DB-backed via PromptRenderer, or hardcoded in prompt builder classes

**Docs:** [agent-system.md](docs/agent-system.md)

---

## Known Issues & Fixes

Documented solutions to common Electron + React + SQLite problems in this project

**Summary:** Nine documented issues with known fixes covering Electron rendering, SQLite compatibility, Tailwind CSS quirks, macOS PATH resolution, and native module ABI mismatches.

**Key Points:**
- Blank screen: add backgroundColor '#ffffff' to BrowserWindow options
- Tailwind grid/widths don't work in Electron — use inline styles instead
- Modals: use absolute inset-0 portal into #app-root, NOT fixed inset-0
- spawn ENOENT: Electron GUI apps don't inherit shell PATH — use getUserShellPath()
- crypto.randomUUID(): import { randomUUID } from 'crypto' in main process

**Docs:** [known-issues.md](docs/known-issues.md)

---

## Patterns & Best Practices

Memory leak prevention, error handling, window behavior, and process management patterns

**Guidelines:**
- Always store interval/timeout references and clear them in app 'before-quit'
- Always wrap JSON.parse in try-catch when reading from the database
- Use isQuitting flag to distinguish window hide vs actual quit
- Kill child processes with negative PID (-pid) to terminate the entire process group
- Always validate IPC handler inputs with validateId() and validateInput()

**Full docs:** [patterns.md](docs/patterns.md)

---

## Pipeline Engine

State machine, transitions, guards, hooks, and seeded pipelines

**Summary:** PipelineEngine drives task state transitions. Transitions have triggers (manual/agent/system), guards (blocking checks), and hooks (async side-effects with three execution policies). Five seeded pipelines: AGENT_PIPELINE, BUG_AGENT_PIPELINE, SIMPLE_PIPELINE, FEATURE_PIPELINE, and BUG_PIPELINE.

**Key Points:**
- Guards are synchronous and block transitions; hooks are async side-effects after success
- Hook execution policies: required (rollback on failure), best_effort (log only), fire_and_forget (not awaited)
- Use AGENT_PIPELINE.id for agent workflow tests, SIMPLE_PIPELINE.id for basic flows
- File: src/core/services/pipeline-engine.ts

**Docs:** [pipeline-engine.md](docs/pipeline-engine.md)

---

## Testing

Test infrastructure, TestContext, factories, and best practices

**Guidelines:**
- Always call ctx.cleanup() in afterEach to close the in-memory DB
- Use SEEDED_PIPELINES.length instead of hardcoded counts
- Call resetCounters() in beforeEach when using factories
- Use AGENT_PIPELINE.id for agent tests, SIMPLE_PIPELINE.id for basic flows

**Full docs:** [testing.md](docs/testing.md)

---

## Workflow Service

Central orchestration, activity logging, and prompt handling

**Summary:** WorkflowService is the single entry point for all business operations — task CRUD, transitions, agent management, prompt handling. All daemon route handlers delegate to it.

**Key Points:**
- File: src/core/services/workflow-service.ts
- Interface: src/core/interfaces/workflow-service.ts
- All business logic goes here — never in IPC handlers, CLI commands, or daemon route handlers

**Docs:** [workflow-service.md](docs/workflow-service.md)

---

## CLI Native Bindings

Dual native builds for Electron and Node ABI coexistence

**Summary:** better-sqlite3 requires separate builds for Electron (build/) and system Node (build-node/). Both are created by postinstall. The CLI selects the correct binary via the nativeBinding option.

**Key Points:**
- build/ is for Electron ABI; build-node/ is for system Node ABI
- Both built automatically by postinstall script
- NODE_MODULE_VERSION mismatch = wrong binary selected — check nativeBinding option

**Docs:** [cli-native-bindings.md](docs/cli-native-bindings.md)

---

## CLI Reference

The agents-manager command-line tool, commands, and project context

**Summary:** The agents-manager CLI is built with Commander.js and connects to the daemon process via an HTTP API client. It auto-starts the daemon if needed via ensureDaemon().

**Key Points:**
- File: src/cli/index.ts
- Run via: npx agents-manager
- CLI is UI-only — no business logic; all commands delegate to daemon API client

**Docs:** [cli-reference.md](docs/cli-reference.md)

---

## Data Layer

SQLite schema, stores, and migrations

**Summary:** better-sqlite3 with WAL mode. Daemon is the sole DB owner via src/core/db.ts. DB path resolves from AM_DB_PATH env or ~/Library/Application Support/agents-manager/agents-manager.db. Migrations run at daemon startup via src/core/migrations.ts.

**Key Points:**
- All stores are in src/core/stores/ — task-store, project-store, pipeline-store, etc.
- Migrations: src/core/migrations.ts — additive only, never destructive
- Cast db.prepare().all() results: as { field: type }[]

**Docs:** [data-layer.md](docs/data-layer.md)

---

## Git & SCM Integration

Worktrees, git operations, PR lifecycle, and branch strategy

**Summary:** LocalWorktreeManager manages git worktrees for isolated agent execution. PRs are created via gh CLI. Branch naming follows task/<id>/<agentType> convention.

**Key Points:**
- Interface: IWorktreeManager in src/core/interfaces/worktree-manager.ts
- Implementation: LocalWorktreeManager in src/core/services/local-worktree-manager.ts
- Branch naming: task/<taskId>/<agentType>

**Docs:** [git-scm-integration.md](docs/git-scm-integration.md)

---

## IPC and Renderer

IPC channels, renderer pages, hooks, and streaming

**Summary:** IPC channels defined in src/shared/ipc-channels.ts. IPC handlers in src/main/ipc-handlers/ are thin wrappers calling the daemon API client. Push events originate from daemon WS → Electron wsClient → sendToRenderer() → renderer.

**Key Points:**
- IPC channels: src/shared/ipc-channels.ts
- IPC handlers: src/main/ipc-handlers/ — thin wrappers delegating to API client
- Renderer calls window.api.<method>() — never direct DB or service access
- Push events: daemon WS → Electron wsClient → sendToRenderer() → renderer
- Preload bridge duplicates channel constants (sandboxed — cannot import shared module)

**Docs:** [ipc-and-renderer.md](docs/ipc-and-renderer.md)

---

## Task Management

Tasks, dependencies, subtasks, features, and filtering

**Summary:** Tasks are the core work unit, each bound to a project and pipeline. Tasks support dependencies (blockedBy), subtasks, and feature grouping. File: src/core/stores/sqlite-task-store.ts.

**Key Points:**
- Task fields: id, projectId, pipelineId, title, description, status, featureId
- Dependencies tracked via task_dependencies table (blockedBy relationship)
- Subtasks share the parent task's pipeline and project

**Docs:** [task-management.md](docs/task-management.md)

---

## Event System

Events, activity log, transition history, and debug timeline

**Summary:** Three log systems — activity log (per-task timeline), transition history (status change audit trail), and the debug timeline (detailed agent turn events). All stored in SQLite.

**Key Points:**
- Activity log: src/core/stores/sqlite-activity-log.ts
- Transition history: recorded on every successful pipeline transition
- Debug timeline: agent turns, tool calls, and output chunks

**Docs:** [event-system.md](docs/event-system.md)

---

## Notifications

Notification architecture, channels, Telegram bot, and configuration

**Summary:** The notification subsystem uses a composite router pattern (MultiChannelNotificationRouter) dispatching to Telegram channel. TelegramBotService provides bidirectional task management via Telegram commands.

**Key Points:**
- MultiChannelNotificationRouter dispatches to all registered INotificationRouter channels via Promise.allSettled
- Active channel: TelegramNotificationRouter (Telegram chat) — DesktopNotificationRouter was removed
- TelegramBotService provides bidirectional task management via /tasks, /task, /create, /help commands
- StubNotificationRouter collects notifications in-memory for testing

**Docs:** [notifications.md](docs/notifications.md)

---
