# Agents Manager — Claude Code Notes

This file provides Claude with context about the codebase. It is auto-generated from `docs/` files.
Run `yarn build:claude` to regenerate.


## Architecture Overview

System architecture, composition root, and the single-execution-engine principle

**Summary:** All business logic lives in src/main/services/ (WorkflowService). The Electron renderer and CLI are UI-only interfaces that share the same createAppServices(db) composition root and SQLite database.

**Key Points:**
- NEVER add business logic to the renderer or CLI — all logic goes in WorkflowService
- src/ is application code; template/ is framework infrastructure (DO NOT MODIFY)
- Both UIs use createAppServices(db) → same WorkflowService → same SQLite file

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

**Summary:** Agent architecture: Agent class combines a PromptBuilder (domain logic) with an AgentLib (engine logic) resolved from AgentLibRegistry. ImplementorPromptBuilder handles plan/implement/review; PrReviewerPromptBuilder handles code review. ScriptedAgent is the test mock.

**Key Points:**
- File: src/main/agents/ — Agent, ImplementorPromptBuilder, PrReviewerPromptBuilder, ScriptedAgent
- File: src/main/libs/ — ClaudeCodeLib, CursorAgentLib, CodexCliLib
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
- File: src/main/services/pipeline-engine.ts

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

**Summary:** WorkflowService is the single entry point for all business operations — task CRUD, transitions, agent management, prompt handling. All IPC handlers and CLI commands delegate to it.

**Key Points:**
- File: src/main/services/workflow-service.ts
- Interface: src/main/interfaces/workflow-service.ts
- All business logic goes here — never in IPC handlers or CLI commands

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

**Summary:** The agents-manager CLI is built with Commander.js and shares the same WorkflowService and SQLite database as the Electron app. It instantiates services via createAppServices(db) directly — no IPC needed.

**Key Points:**
- File: src/cli/index.ts
- Run via: npx agents-manager
- CLI is UI-only — no business logic; delegates everything to WorkflowService

**Docs:** [cli-reference.md](docs/cli-reference.md)

---

## Data Layer

SQLite schema, stores, and migrations

**Summary:** better-sqlite3 with WAL mode. DB path resolves from --db flag, AM_DB_PATH env, or ~/Library/Application Support/agents-manager/agents-manager.db. Migrations run at startup via src/main/migrations.ts.

**Key Points:**
- All stores are in src/main/stores/ — task-store, project-store, pipeline-store, etc.
- Migrations: src/main/migrations.ts — additive only, never destructive
- Cast db.prepare().all() results: as { field: type }[]

**Docs:** [data-layer.md](docs/data-layer.md)

---

## Git & SCM Integration

Worktrees, git operations, PR lifecycle, and branch strategy

**Summary:** LocalWorktreeManager manages git worktrees for isolated agent execution. PRs are created via gh CLI. Branch naming follows task/<id>/<mode> convention.

**Key Points:**
- Interface: IWorktreeManager in src/main/interfaces/worktree-manager.ts
- Implementation: LocalWorktreeManager in src/main/services/local-worktree-manager.ts
- Branch naming: task/<taskId>/<mode>

**Docs:** [git-scm-integration.md](docs/git-scm-integration.md)

---

## IPC and Renderer

IPC channels, renderer pages, hooks, and streaming

**Summary:** 57+ IPC channels defined in src/shared/ipc-channels.ts. Renderer pages in src/renderer/pages/. Custom hooks in src/renderer/hooks/ use window.api (the preload bridge) to call IPC handlers.

**Key Points:**
- IPC channels: src/shared/ipc-channels.ts
- Renderer calls window.api.<method>() — never direct DB access
- Streaming uses onMessage callback pattern for live agent output

**Docs:** [ipc-and-renderer.md](docs/ipc-and-renderer.md)

---

## Task Management

Tasks, dependencies, subtasks, features, and filtering

**Summary:** Tasks are the core work unit, each bound to a project and pipeline. Tasks support dependencies (blockedBy), subtasks, and feature grouping. File: src/main/services/task-store.ts.

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
- Activity log: src/main/stores/activity-log-store.ts
- Transition history: recorded on every successful pipeline transition
- Debug timeline: agent turns, tool calls, and output chunks

**Docs:** [event-system.md](docs/event-system.md)

---
