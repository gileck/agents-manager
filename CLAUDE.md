# Agents Manager — Claude Code Notes

This file provides Claude with context about the codebase. It is auto-generated from `docs/` files.
Run `yarn build:claude` to regenerate.


## Abstractions & Separations

All interface-based abstractions in the system — what each separates, why, and key files

**Summary:** Documents every abstraction/separation in the codebase: what it decouples, why the separation exists, interface and implementation files, and how implementations are selected. Covers agent engine, prompt builders, pipeline engine, data stores, git/SCM operations, notifications, session history, workflow service, and more.

**Key Points:**
- Every abstraction follows the pattern: interface (src/core/interfaces/) → implementation(s) (src/core/services/ or src/core/stores/) → optional registry/factory
- AgentLib separates agent domain logic from AI engine; PromptBuilder separates prompt construction from agent execution
- GitOps (low-level git commands) and ScmPlatform (platform-level PR operations) are separate abstractions — do not merge them
- All store interfaces decouple domain logic from SQLite — implementations are in src/core/stores/sqlite-*.ts
- WorkflowService is the convergence abstraction — all clients (Electron, CLI, Web, Telegram) call the same interface

**Docs:** [abstractions.md](docs/abstractions.md)

---

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

## Error Handling Guidelines

Error display patterns, user-facing error requirements, and error handling rules

**Guidelines:**
- NEVER use bare `console.error` in renderer code — always pair with `reportError()` or `<InlineError>`
- NEVER use empty `.catch(() => {})` — at minimum use `.catch((err) => reportError(err, 'Context'))`
- Every error the user triggers must be visible via toast or inline error with Copy Error + Report Bug
- Use `reportError(err, 'Context')` for async operations in event handlers and callbacks
- Use `<InlineError message={msg} context={ctx} />` for data loading errors in component render

**Full docs:** [error-handling.md](docs/error-handling.md)

---

## Agent Lib Features

Feature reference for the IAgentLib abstraction — interfaces, logic, and UX flows

**Summary:** Documents each feature supported by the agent lib abstraction: interactive tool approval, streaming, hooks, subagents, system prompt customization, slash commands, plugins, images, session resume, and prompt injection. Each section covers the interface contract, service-layer logic, UX flow, and which libs implement it.

**Key Points:**
- All features are opt-in via AgentLibFeatures flags and optional fields on AgentLibRunOptions/AgentLibCallbacks
- chat-agent-service.ts adapts behavior per lib using supportedFeatures() checks
- Interface: src/core/interfaces/agent-lib.ts — Reference impl: src/core/libs/claude-code-lib.ts
- Feature flags: images, hooks, thinking, nativeResume

**Docs:** [agent-lib-features.md](docs/agent-lib-features.md)

---

## Agent System

Agent types, execution lifecycle, prompts, validation, and context accumulation

**Summary:** Agent architecture: Agent class combines a PromptBuilder (domain logic) with an AgentLib (engine logic) resolved from AgentLibRegistry. Role-based prompt builders: PlannerPromptBuilder, DesignerPromptBuilder, ImplementorPromptBuilder, InvestigatorPromptBuilder, ReviewerPromptBuilder. ScriptedAgent is the test mock.

**Key Points:**
- File: src/core/agents/ — Agent, PlannerPromptBuilder, DesignerPromptBuilder, ImplementorPromptBuilder, InvestigatorPromptBuilder, ReviewerPromptBuilder, ScriptedAgent
- File: src/core/libs/ — ClaudeCodeLib, CursorAgentLib, CodexCliLib
- Agent resolves AgentLib from registry via config.engine at execute() time
- Prompt templates: file-based (.agents/) via PromptRenderer, or hardcoded in prompt builder classes

**Docs:** [agent-system.md](docs/agent-system.md)

---

## Agent Types & Session Resume

All agent types, their identifiers, session keys, and how conversation resume works

**Summary:** Two agent categories: Pipeline agents (investigator, designer, planner, implementor, reviewer) run through the task pipeline with session resume keyed by taskId+agentType. Thread chat agents run interactive conversations with session resume keyed by chat sessionId (thread) or pipelineSessionId (agent-chat review).

**Key Points:**
- Pipeline agents are keyed by taskId + agentType; session ID = first completed run's ID
- Thread chat agents are keyed by chat session UUID (thread ID); resume on follow-up messages
- Agent-chat (review) sessions resume the pipeline agent's SDK session via pipelineSessionId
- All session resume uses the SDK's native resume mechanism (not manual history replay)
- sessionId MUST be passed in AgentLibRunOptions for SDK resume to work

**Docs:** [agent-types.md](docs/agent-types.md)

---

## Client-Daemon Convergence

How all UI clients (Electron, CLI, Web, Telegram bot) converge on the same daemon logic

**Summary:** Every UI action — whether from Electron, CLI, Web UI, or Telegram bot — ends up calling the same WorkflowService methods in the daemon process. This guarantees identical behavior: pipeline guards, hooks, agent execution, notifications, and event logging all run the same way regardless of the originating client.

**Key Points:**
- All clients converge on the same daemon WorkflowService — transitions, task CRUD, agent starts all go through one code path
- Telegram bot runs inside the daemon process with direct service references (zero network hops)
- Electron and CLI are thin HTTP clients — they call daemon REST endpoints that delegate to the same services
- Pipeline hooks (start_agent, notify, push_and_create_pr) fire identically regardless of which client triggered the transition
- Daemon singleton enforced by health check probe + OS TCP port bind on fixed port 3847

**Docs:** [client-daemon-convergence.md](docs/client-daemon-convergence.md)

---

## File-Based Agent Configuration

Customizing agent prompts and execution config via .agents/ directory

**Summary:** The .agents/ directory provides git-tracked, per-project customization of agent prompts and execution parameters. Files override hardcoded defaults with a 2-tier resolution chain: File (.agents/) > Code (builder defaults).

**Key Points:**
- Directory: {projectPath}/.agents/{agentType}/ — prompt.md + config.json per agent
- 2-tier resolution: File > Code — each field resolves independently
- CLI: npx agents-manager agents init|show|list — daemon-independent (filesystem only)
- Loader: src/core/agents/agent-file-config-loader.ts — never throws, logs all decisions
- Mode-specific prompts: prompt.revision.md, prompt.merge.md, prompt.resume.md, prompt.uncommitted.md

**Docs:** [file-based-agent-config.md](docs/file-based-agent-config.md)

---

## Known Issues & Fixes

Documented solutions to common Electron + React + SQLite problems in this project

**Summary:** Twelve documented issues with known fixes covering Electron rendering, SQLite compatibility, Tailwind CSS quirks, macOS PATH resolution, native module ABI mismatches, SDK permission validation, and daemon logging.

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

**Summary:** PipelineEngine drives task state transitions. Transitions have triggers (manual/agent/system), guards (blocking checks), and hooks (async side-effects with three execution policies). One seeded pipeline: AGENT_PIPELINE (agent-driven workflow with investigation, design, plan, implement, and review phases).

**Key Points:**
- Guards are synchronous and block transitions; hooks are async side-effects after success
- Hook execution policies: required (rollback on failure), best_effort (log only), fire_and_forget (not awaited)
- Use AGENT_PIPELINE.id for all tests (the only seeded pipeline)
- File: src/core/services/pipeline-engine.ts

**Docs:** [pipeline-engine.md](docs/pipeline-engine.md)

---

## Testing

Test infrastructure, TestContext, factories, and best practices

**Guidelines:**
- Always call ctx.cleanup() in afterEach to close the in-memory DB
- Use SEEDED_PIPELINES.length instead of hardcoded counts
- Call resetCounters() in beforeEach when using factories
- Use AGENT_PIPELINE.id for all tests (the only seeded pipeline)

**Full docs:** [testing.md](docs/testing.md)

---

## Web UI

Browser-based UI client sharing the same React renderer as Electron

**Summary:** The web UI serves the same React app as Electron but runs in a standard browser. The API shim replaces the Electron preload bridge with direct HTTP + browser WebSocket to the daemon.

**Key Points:**
- Web entry point: src/web/index.tsx — installs API shim, mounts same <App/> as Electron
- API shim (src/web/api-shim.ts) implements ApiShape using ApiClient (HTTP) + browser WebSocket
- Shared type: src/shared/api-shape.ts — single source of truth for window.api surface
- Build: `yarn build:web` → dist-web/ — daemon serves it at http://localhost:3847
- Shell operations (iTerm, VS Code, Chrome) work via daemon REST endpoints, not Electron IPC
- All renderer code (src/renderer/) is shared — zero Electron imports

**Docs:** [web-ui.md](docs/web-ui.md)

---

## Workflow Service

Central orchestration, activity logging, and prompt handling

**Summary:** WorkflowService is the single entry point for all business operations — task CRUD, transitions, agent management, prompt handling. All daemon route handlers delegate to it.

**Key Points:**
- File: src/core/services/workflow-service.ts
- Interface: src/core/interfaces/workflow-service.ts
- All business logic goes here — never in IPC handlers, CLI commands, or daemon route handlers
- Pipeline diagnostics, hook retry, phase advancement, and event dismissal live in PipelineInspectionService

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

## Creating a New Agent

Step-by-step guide for adding a new agent type to the system

**Summary:** After the registration boilerplate refactor, adding a new agent type requires only 3 files: a prompt builder, a DOC_PHASES entry, and extraction logic. Registries in setup.ts (AGENT_BUILDERS), types.ts (FEEDBACK_ENTRY_TYPES), and agent-service.ts (extractDoc) auto-derive from these sources.

**Key Points:**
- 3-file workflow: (1) create prompt builder, (2) add DOC_PHASES entry, (3) add extraction method + registry entry
- AGENT_BUILDERS map in src/core/agents/agent-builders.ts replaces scattered imports and registration lines in setup.ts
- FEEDBACK_ENTRY_TYPES in types.ts auto-derives from DOC_PHASES — no manual array editing needed
- extractDoc() in post-run-extractor.ts dispatches to the right extractor via a registry map — no editing agent-service.ts

**Docs:** [create-new-agent.md](docs/create-new-agent.md)

---

## Data Layer

SQLite schema, stores, and migrations

**Summary:** better-sqlite3 with WAL mode. Daemon is the sole DB owner via src/core/db.ts. DB path resolves from AM_DB_PATH env or ~/Library/Application Support/agents-manager/agents-manager.db. Fresh databases apply baseline schema from src/core/schema.ts; existing databases run incremental migrations from src/core/migrations.ts.

**Key Points:**
- All stores are in src/core/stores/ — task-store, project-store, pipeline-store, etc.
- Baseline schema: src/core/schema.ts — applied to fresh databases. Incremental migrations: src/core/migrations.ts
- Cast db.prepare().all() results: as { field: type }[]
- PRAGMA foreign_keys = ON — all FK constraints are enforced. Synthetic/virtual IDs will fail on FK-constrained columns. Check the FK table in data-layer.md before inserting into any table with foreign keys.

**Docs:** [data-layer.md](docs/data-layer.md)

---

## Git & SCM Integration

Worktrees, git operations, PR lifecycle, and branch strategy

**Summary:** LocalWorktreeManager manages git worktrees for isolated agent execution. PRs are created via gh CLI. Branch naming follows task/<id> convention.

**Key Points:**
- Interface: IWorktreeManager in src/core/interfaces/worktree-manager.ts
- Implementation: LocalWorktreeManager in src/core/services/local-worktree-manager.ts
- Branch naming: task/<taskId> (single-phase) or task/<taskId>/phase-{n} (multi-phase) or task/<taskId>/integration (multi-phase task branch)

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
