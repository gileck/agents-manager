---
title: Abstractions & Separations
description: All interface-based abstractions in the system — what each separates, why, and key files
summary: "Documents every abstraction/separation in the codebase: what it decouples, why the separation exists, interface and implementation files, and how implementations are selected. Covers agent engine, prompt builders, pipeline engine, data stores, git/SCM operations, notifications, session history, workflow service, and more."
priority: 1
key_points:
  - "Every abstraction follows the pattern: interface (src/core/interfaces/) → implementation(s) (src/core/services/ or src/core/stores/) → optional registry/factory"
  - "AgentLib separates agent domain logic from AI engine; PromptBuilder separates prompt construction from agent execution"
  - "GitOps (low-level git commands) and ScmPlatform (platform-level PR operations) are separate abstractions — do not merge them"
  - "All store interfaces decouple domain logic from SQLite — implementations are in src/core/stores/sqlite-*.ts"
  - "WorkflowService is the convergence abstraction — all clients (Electron, CLI, Web, Telegram) call the same interface"
---
# Abstractions & Separations

Every interface-based abstraction in the system, what it decouples, and why.

## The Pattern

All abstractions follow the same shape:

```
Interface (src/core/interfaces/)
  → Implementation(s) (src/core/services/ or src/core/stores/)
  → Optional registry or factory for runtime selection
```

Each abstraction exists to separate **what** from **how** — the caller depends only on the interface, never on the implementation. This enables:
- Pluggable implementations (e.g., multiple AI engines)
- Testability via stubs (e.g., StubGitOps, StubNotificationRouter)
- Project-scoped instances via factories (e.g., one GitOps per project path)

---

## 1. AgentLib — Agent Logic vs AI Engine

**What it separates:** Agent domain logic (prompts, roles, execution flow) from AI engine implementation (Claude SDK, Codex CLI, Cursor).

**Why:** The same agent (e.g., Implementor) should work identically regardless of which AI engine runs it. Adding a new engine should not require changing any agent code.

| | |
|---|---|
| **Interface** | `src/core/interfaces/agent-lib.ts` — `IAgentLib` |
| **Base class** | `src/core/libs/base-agent-lib.ts` — `BaseAgentLib` (shared timeout, abort, permission chain, telemetry) |
| **Implementations** | `src/core/libs/claude-code-lib.ts` — Claude SDK |
| | `src/core/libs/cursor-agent-lib.ts` — Cursor |
| | `src/core/libs/codex-cli-lib.ts` — Codex CLI |
| | `src/core/libs/codex-app-server-lib.ts` — Codex App Server |
| **Registry** | `src/core/services/agent-lib-registry.ts` — `AgentLibRegistry` |
| **Selection** | Agent resolves its lib from the registry via `config.engine` at `execute()` time |

**Key methods:** `execute()`, `stop()`, `getTelemetry()`, `supportedFeatures()`

See [agent-lib-features.md](./agent-lib-features.md) for the full feature matrix per engine.

---

## 2. PromptBuilder — Prompt Construction vs Agent Execution

**What it separates:** What to ask the agent (prompt domain logic, context assembly, output format) from how the agent executes (engine, streaming, session management).

**Why:** Each agent role (investigator, designer, planner, implementor, reviewer) has unique prompt logic, but they all share the same execution infrastructure. New roles can be added by writing a new PromptBuilder without touching execution code.

| | |
|---|---|
| **Base class** | `src/core/agents/base-agent-prompt-builder.ts` — `BaseAgentPromptBuilder` |
| **Implementations** | `src/core/agents/investigator-prompt-builder.ts` |
| | `src/core/agents/designer-prompt-builder.ts` |
| | `src/core/agents/planner-prompt-builder.ts` |
| | `src/core/agents/implementor-prompt-builder.ts` |
| | `src/core/agents/reviewer-prompt-builder.ts` |
| | `src/core/agents/task-workflow-reviewer-prompt-builder.ts` |
| **Consumer** | `src/core/agents/agent.ts` — `Agent` class combines a PromptBuilder with an AgentLib |

**Key methods:** `buildSystemPrompt()`, `buildPrompt()`, `getOutputSchema()`

See [agent-system.md](./agent-system.md) for the full agent architecture.

---

## 3. AgentFramework — Agent Registration vs Agent Usage

**What it separates:** How agents are registered and looked up from how they are used by services.

**Why:** Services (AgentService, WorkflowService) need to get an agent by type without knowing how agents are constructed or registered.

| | |
|---|---|
| **Interface** | `src/core/interfaces/agent-framework.ts` — `IAgentFramework` |
| **Implementation** | `src/core/services/agent-framework-impl.ts` — `AgentFrameworkImpl` |

**Key methods:** `getAgent()`, `listAgents()`, `getAvailableAgents()`, `registerAgent()`

---

## 4. Pipeline Engine — State Machine vs Business Logic

**What it separates:** The state machine (statuses, transitions, execution order) from domain-specific guards and hooks.

**Why:** The pipeline engine is a generic state machine that knows nothing about agents, PRs, or notifications. Domain logic is injected via named guards and hooks registered at startup. This keeps the engine reusable and testable independently of business rules.

| | |
|---|---|
| **Interface** | `src/core/interfaces/pipeline-engine.ts` — `IPipelineEngine` |
| **Implementation** | `src/core/services/pipeline-engine.ts` — `PipelineEngine` |
| **Guards** | `src/core/handlers/core-guards.ts` — registered via `registerCoreGuards()` |
| **Hooks** | `src/core/handlers/agent-handler.ts`, `notification-handler.ts`, `prompt-handler.ts`, `scm-handler.ts`, `phase-handler.ts` |

**Key methods:** `getValidTransitions()`, `executeTransition()`, `registerGuard()`, `registerHook()`

See [pipeline-engine.md](./pipeline-engine.md) for guard/hook details.

---

## 5. Data Stores — Domain Logic vs Persistence

**What it separates:** Domain operations (CRUD, queries, filtering) from storage implementation (currently SQLite).

**Why:** Services depend on store interfaces, not on SQLite directly. This makes services testable with in-memory databases and keeps SQL isolated in store implementations.

| Interface | Implementation |
|---|---|
| `ITaskStore` | `sqlite-task-store.ts` |
| `IProjectStore` | `sqlite-project-store.ts` |
| `IPipelineStore` | `sqlite-pipeline-store.ts` |
| `IAgentRunStore` | `sqlite-agent-run-store.ts` |
| `IActivityLog` | `sqlite-activity-log.ts` |
| `ITaskEventLog` | `sqlite-task-event-log.ts` |
| `IAppDebugLog` | `sqlite-app-debug-log.ts` |
| `IChatSessionStore` | `sqlite-chat-session-store.ts` |
| `IChatMessageStore` | `sqlite-chat-message-store.ts` |
| `IFeatureStore` | `sqlite-feature-store.ts` |
| `ISettingsStore` | `sqlite-settings-store.ts` |
| `IAgentDefinitionStore` | `sqlite-agent-definition-store.ts` |
| `IAutomatedAgentStore` | `sqlite-automated-agent-store.ts` |
| `ITaskContextStore` | `sqlite-task-context-store.ts` |
| `ITaskPhaseStore` | `sqlite-task-phase-store.ts` |
| `ITaskArtifactStore` | `sqlite-task-artifact-store.ts` |
| `IInAppNotificationStore` | `sqlite-in-app-notification-store.ts` |
| `IPendingPromptStore` | `sqlite-pending-prompt-store.ts` |
| `IKanbanBoardStore` | `sqlite-kanban-board-store.ts` |
| `IUserStore` | `sqlite-user-store.ts` |

All interfaces are in `src/core/interfaces/`. All implementations are in `src/core/stores/`.

See [data-layer.md](./data-layer.md) for schema and migration details.

---

## 6. GitOps — Git Command Semantics vs Shell Execution

**What it separates:** High-level git operations (commit, push, rebase, branch) from the shell commands that implement them.

**Why:** Agent code and services express intent ("push this branch") without knowing the exact CLI invocation. Stubs allow testing without a real git repo.

| | |
|---|---|
| **Interface** | `src/core/interfaces/git-ops.ts` — `IGitOps` |
| **Implementation** | `src/core/services/local-git-ops.ts` — `LocalGitOps` (shells out to `git`) |
| **Stub** | `src/core/services/stub-git-ops.ts` — `StubGitOps` (in-memory no-op) |
| **Factory** | `createGitOps(cwd)` in `src/core/providers/setup.ts` — creates a project-scoped instance |

**Key methods:** `createBranch()`, `checkout()`, `fetch()`, `push()`, `pull()`, `diff()`, `commit()`, `rebase()`, `getCurrentBranch()`, `status()`

---

## 7. ScmPlatform — SCM Operations vs Platform API

**What it separates:** Platform-level SCM operations (create PR, merge PR, get PR status, get checks) from the specific platform API (GitHub via `gh` CLI).

**Why:** PR operations are platform-specific (GitHub, GitLab, Bitbucket). This abstraction isolates platform details so the system could support other SCM platforms without changing service code.

| | |
|---|---|
| **Interface** | `src/core/interfaces/scm-platform.ts` — `IScmPlatform` |
| **Implementation** | `src/core/services/github-scm-platform.ts` — `GitHubScmPlatform` (shells out to `gh` CLI) |
| **Stub** | `src/core/services/stub-scm-platform.ts` — `StubScmPlatform` |
| **Factory** | `createScmPlatform(path)` in `src/core/providers/setup.ts` |

**Key methods:** `createPR()`, `mergePR()`, `getPRStatus()`, `getPRChecks()`

### GitOps vs ScmPlatform

These are deliberately separate abstractions:
- **GitOps** = low-level git commands (commit, push, rebase) — works with any git remote
- **ScmPlatform** = platform API operations (PRs, checks, merge) — platform-specific (GitHub)

An agent uses GitOps to commit and push, then ScmPlatform to create a PR.

---

## 8. WorktreeManager — Worktree Lifecycle vs Git Implementation

**What it separates:** Worktree lifecycle operations (create, get, list, lock, unlock, delete, cleanup) from the git CLI commands that manage worktrees.

**Why:** Agents execute in isolated worktrees. The manager handles the lifecycle; services don't need to know the underlying git worktree commands.

| | |
|---|---|
| **Interface** | `src/core/interfaces/worktree-manager.ts` — `IWorktreeManager` |
| **Implementation** | `src/core/services/local-worktree-manager.ts` — `LocalWorktreeManager` |
| **Stub** | `src/core/services/stub-worktree-manager.ts` — `StubWorktreeManager` |
| **Factory** | `createWorktreeManager(path)` in `src/core/providers/setup.ts` |

**Key methods:** `create()`, `get()`, `list()`, `lock()`, `unlock()`, `delete()`, `cleanup()`

See [git-scm-integration.md](./git-scm-integration.md) for worktree directory conventions and branch naming.

---

## 9. NotificationRouter — Notification Dispatch vs Channel Implementation

**What it separates:** The act of sending a notification from the specific delivery channel (Telegram, in-app, etc.).

**Why:** Notifications should be sent to all configured channels simultaneously. New channels can be added by implementing `INotificationRouter` and registering it on the composite router.

| | |
|---|---|
| **Interface** | `src/core/interfaces/notification-router.ts` — `INotificationRouter` |
| **Composite** | `src/core/services/multi-channel-notification-router.ts` — `MultiChannelNotificationRouter` (dispatches to all registered routers via `Promise.allSettled`) |
| **Implementations** | `src/core/services/telegram-notification-router.ts` — `TelegramNotificationRouter` |
| | `src/core/services/in-app-notification-router.ts` — `InAppNotificationRouter` (persists to `IInAppNotificationStore` and emits a WebSocket event) |
| **Stub** | `src/core/services/stub-notification-router.ts` — `StubNotificationRouter` (collects in-memory for tests) |

**Key methods:** `send(notification)`

**Pattern:** Composite — `MultiChannelNotificationRouter` wraps multiple `INotificationRouter` instances. Routers are added dynamically at runtime (e.g., when a Telegram bot starts).

See [notifications.md](./notifications.md) for channel details.

---

## 10. SessionHistoryProvider — Session Resume Logic vs Message Storage

**What it separates:** How prior conversation history is loaded and formatted from where messages are stored.

**Why:** Engines that don't support native session resume need conversation history replayed in the prompt. This abstraction isolates the history loading/formatting logic from the storage layer.

| | |
|---|---|
| **Interface** | `src/core/interfaces/session-history-provider.ts` — `ISessionHistoryProvider` |
| **Implementation** | `src/core/services/agent-run-history-provider.ts` — `AgentRunHistoryProvider` |
| **Formatter** | `src/core/services/session-history-formatter.ts` — `SessionHistoryFormatter` |

**Key methods:** `getHistory(sessionId)`

---

## 11. WorkflowService — Business Operations vs Client Transport

**What it separates:** All business operations (task CRUD, transitions, agent management, prompt handling) from the transport layer that clients use to reach them.

**Why:** Every client — Electron (IPC → HTTP), CLI (HTTP), Web (HTTP), Telegram bot (direct call) — must execute identical business logic. WorkflowService is the single convergence point that guarantees this.

| | |
|---|---|
| **Interface** | `src/core/interfaces/workflow-service.ts` — `IWorkflowService` |
| **Implementation** | `src/core/services/workflow-service.ts` — `WorkflowService` |

**Key methods:** `createTask()`, `updateTask()`, `deleteTask()`, `transitionTask()`, `startAgent()`, `resumeAgent()`, `stopAgent()`, `respondToPrompt()`, `mergePR()`

See [client-daemon-convergence.md](./client-daemon-convergence.md) for how all clients converge on this service.

---

## 12. AgentService — Agent Orchestration vs Agent Execution

**What it separates:** Agent lifecycle management (execute, stop, wait, recover) from the actual agent execution logic.

**Why:** The service handles concerns like run tracking, orphan recovery, concurrent execution limits, and telemetry flushing — separate from what the agent actually does.

| | |
|---|---|
| **Interface** | `src/core/interfaces/agent-service.ts` — `IAgentService` |
| **Implementation** | `src/core/services/agent-service.ts` — `AgentService` |

**Key methods:** `execute()`, `waitForCompletion()`, `stop()`, `recoverOrphanedRuns()`

---

## 13. PipelineInspectionService — Pipeline Diagnostics vs Execution

**What it separates:** Pipeline diagnostics and manual intervention (retry hooks, advance phase) from the core pipeline execution engine.

**Why:** Debugging and manual recovery operations should not pollute the core state machine. This service provides a separate surface for inspection and intervention.

| | |
|---|---|
| **Interface** | `src/core/interfaces/pipeline-inspection-service.ts` — `IPipelineInspectionService` |
| **Implementation** | `src/core/services/pipeline-inspection-service.ts` — `PipelineInspectionService` |

**Key methods:** `getPipelineDiagnostics()`, `retryHook()`, `advancePhase()`

---

## 14. MCP Tool Definition — Tool Definitions vs Engine Format

**What it separates:** Engine-agnostic tool definitions from engine-specific tool formats.

**Why:** MCP tools are defined once in a generic format. Each engine lib converts them to its native format (Claude SDK MCP tools, Codex tools, etc.).

| | |
|---|---|
| **Interface** | `src/core/interfaces/mcp-tool.ts` — `GenericMcpToolDefinition` |
| **Consumers** | Each `IAgentLib` implementation converts to its native format |

---

## 15. DevServerManager — Dev Server Lifecycle vs Implementation

**What it separates:** Dev server start/stop/status operations from subprocess management.

| | |
|---|---|
| **Interface** | `src/core/interfaces/dev-server-manager.ts` — `IDevServerManager` |
| **Implementation** | `src/core/services/dev-server-manager.ts` — `DevServerManager` |

---

## 16. TelegramBotService — Bot Lifecycle vs Business Logic

**What it separates:** Telegram bot lifecycle management (start, stop, status, token validation) from the business logic the bot executes (task management, transitions).

| | |
|---|---|
| **Interface** | `src/core/interfaces/telegram-bot-service.ts` — `ITelegramBotService` |
| **Lifecycle** | `src/core/services/telegram-bot-service.ts` — `TelegramBotService` |
| **Business logic** | `src/core/services/telegram-agent-bot-service.ts` — `TelegramAgentBotService` |

---

## 17. AutomatedAgentPromptBuilder — Automated Prompt Logic vs Execution

**What it separates:** Prompt construction for automated agents (context building, output schema) from the automated agent execution framework.

**Why:** Different automated agent templates need different prompt strategies without changing the execution infrastructure.

| | |
|---|---|
| **Interface** | `src/core/interfaces/automated-agent-prompt-builder.ts` — `IAutomatedAgentPromptBuilder` |

---

## 18. IAgent — Agent Role vs Execution Infrastructure

**What it separates:** Agent role identity and execution contract from the infrastructure that manages agent runs (tracking, recovery, telemetry).

**Why:** `AgentService` and `AgentFramework` operate on agents through a common interface without knowing whether the agent is a real pipeline agent (backed by a PromptBuilder + AgentLib) or a test double. This also enables `ScriptedAgent` to stand in for any real agent in tests.

| | |
|---|---|
| **Interface** | `src/core/interfaces/agent.ts` — `IAgent` |
| **Implementations** | `src/core/agents/agent.ts` — `Agent` (production: combines a `BaseAgentPromptBuilder` with an `AgentLib` resolved from `AgentLibRegistry`) |
| | `src/core/agents/scripted-agent.ts` — `ScriptedAgent` (test double: executes a configurable `AgentScript` function, no AI engine required) |

**Key methods:** `execute()`, `stop()`, `isAvailable()`

---

## 19. ITimelineSource — Timeline Data Source vs Timeline Assembly

**What it separates:** Individual data sources that contribute timeline entries (activity log, agent runs, transitions, prompts, etc.) from the service that assembles, deduplicates, sorts, and paginates them into a unified debug timeline.

**Why:** The debug timeline aggregates entries from many store-backed sources. Each source is independent and queries one table. Adding a new source type requires only implementing `ITimelineSource` and registering it — no changes to `TimelineService`.

| | |
|---|---|
| **Interface** | `src/core/services/timeline/types.ts` — `ITimelineSource` |
| **Implementations** | `src/core/services/timeline/sources/activity-source.ts` — `ActivitySource` |
| | `src/core/services/timeline/sources/agent-run-source.ts` — `AgentRunSource` |
| | `src/core/services/timeline/sources/artifact-source.ts` — `ArtifactSource` |
| | `src/core/services/timeline/sources/context-source.ts` — `ContextSource` |
| | `src/core/services/timeline/sources/event-source.ts` — `EventSource` |
| | `src/core/services/timeline/sources/phase-source.ts` — `PhaseSource` |
| | `src/core/services/timeline/sources/prompt-source.ts` — `PromptSource` |
| | `src/core/services/timeline/sources/transition-source.ts` — `TransitionSource` |
| **Composite** | `src/core/services/timeline/timeline-service.ts` — `TimelineService` (collects entries from all sources, deduplicates by ID, sorts by timestamp descending, applies keyset pagination) |

**Key methods:** `getEntries(taskId)` (on each source); `getTimeline(taskId, options)` (on `TimelineService`)

---

## Summary Table

| # | Abstraction | Separates | Benefit |
|---|---|---|---|
| 1 | **AgentLib** | Agent logic ↔ AI engine | Pluggable engines (Claude, Codex, Cursor) |
| 2 | **PromptBuilder** | Prompt domain ↔ agent execution | New roles without changing execution |
| 3 | **AgentFramework** | Agent registration ↔ agent usage | Services get agents by type |
| 4 | **PipelineEngine** | State machine ↔ business rules | Reusable engine, injectable guards/hooks |
| 5 | **Data Stores** | Domain ops ↔ SQLite | Testable with in-memory DB |
| 6 | **GitOps** | Git semantics ↔ shell commands | Testable, mockable git |
| 7 | **ScmPlatform** | SCM ops ↔ platform API | Platform-agnostic PR operations |
| 8 | **WorktreeManager** | Worktree lifecycle ↔ git CLI | Testable worktree management |
| 9 | **NotificationRouter** | Dispatch ↔ channel | Multiple channels, composite pattern (Telegram, InApp) |
| 10 | **SessionHistoryProvider** | Resume logic ↔ message storage | Engine-agnostic history replay |
| 11 | **WorkflowService** | Business logic ↔ client transport | All clients execute identical code |
| 12 | **AgentService** | Agent lifecycle ↔ agent execution | Run tracking, recovery, limits |
| 13 | **PipelineInspectionService** | Diagnostics ↔ execution | Debug/recover without polluting engine |
| 14 | **MCP Tool Definition** | Tool definition ↔ engine format | Define once, convert per engine |
| 15 | **DevServerManager** | Server lifecycle ↔ subprocess | Clean start/stop interface |
| 16 | **TelegramBotService** | Bot lifecycle ↔ business logic | Separate management from commands |
| 17 | **AutomatedAgentPromptBuilder** | Prompt logic ↔ execution | Template-specific prompts |
| 18 | **IAgent** | Agent role ↔ execution infrastructure | Testable with ScriptedAgent, uniform agent interface |
| 19 | **ITimelineSource** | Data source ↔ timeline assembly | Add new sources without changing TimelineService |
