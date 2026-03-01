---
title: IPC and Renderer
description: IPC channels, renderer pages, hooks, and streaming
summary: "IPC channels defined in src/shared/ipc-channels.ts. IPC handlers in src/main/ipc-handlers/ are thin wrappers calling the daemon API client. Push events originate from daemon WS → Electron wsClient → sendToRenderer() → renderer."
priority: 3
key_points:
  - "IPC channels: src/shared/ipc-channels.ts"
  - "IPC handlers: src/main/ipc-handlers/ \u2014 thin wrappers delegating to API client"
  - "Renderer calls window.api.<method>() \u2014 never direct DB or service access"
  - "Push events: daemon WS \u2192 Electron wsClient \u2192 sendToRenderer() \u2192 renderer"
  - "Preload bridge duplicates channel constants (sandboxed \u2014 cannot import shared module)"
---
# IPC and Renderer

IPC channels, renderer pages, hooks, and streaming.

## IPC Channel Definitions

**File:** `src/shared/ipc-channels.ts`

### Channel Inventory

**Item Operations (template, 5):**
`item:list`, `item:get`, `item:create`, `item:update`, `item:delete`

**Settings (2):**
`settings:get`, `settings:update`

**App/Navigation (2):**
`app:get-version`, `navigate` (push)

**Project Operations (5):**
`project:list`, `project:get`, `project:create`, `project:update`, `project:delete`

**Task Operations (16):**
`task:list`, `task:get`, `task:create`, `task:update`, `task:delete`, `task:reset`, `task:transition`, `task:transitions`, `task:dependencies`, `task:dependents`, `task:add-dependency`, `task:remove-dependency`, `task:context-entries`, `task:debug-timeline`, `task:worktree`, `task:workflow-review`

**Pipeline Diagnostics (6):**
`task:all-transitions`, `task:force-transition`, `task:guard-check`, `task:hook-retry`, `task:pipeline-diagnostics`, `task:advance-phase`

**Pipeline Operations (2):**
`pipeline:list`, `pipeline:get`

**Agent Operations (12):**
`agent:start`, `agent:stop`, `agent:runs`, `agent:get`, `agent:active-task-ids`, `agent:active-runs`, `agent:all-runs`, `agent:send-message`, `agent:output` (push), `agent:interrupted-runs` (push), `agent:message` (push), `agent:status` (push)

**Event/Activity Operations (2):**
`event:list`, `activity:list`

**Prompt Operations (2):**
`prompt:list`, `prompt:respond`

**Artifact Operations (1):**
`artifact:list`

**Feature Operations (5):**
`feature:list`, `feature:get`, `feature:create`, `feature:update`, `feature:delete`

**Agent Definition Operations (5):**
`agent-def:list`, `agent-def:get`, `agent-def:create`, `agent-def:update`, `agent-def:delete`

**Agent Lib (2):**
`agent-lib:list`, `agent-lib:list-models`

**Git Operations (task-scoped, 9):**
`git:diff`, `git:stat`, `git:working-diff`, `git:status`, `git:reset-file`, `git:clean`, `git:pull`, `git:log`, `git:show`

**Source Control (project-scoped, 3):**
`git:project-log`, `git:branch`, `git:commit-detail`

**Dashboard (1):**
`dashboard:stats`

**Chat Operations (8):**
`chat:send`, `chat:stop`, `chat:messages`, `chat:clear`, `chat:summarize`, `chat:costs`, `chat:output` (push), `chat:message` (push)

**Chat Sessions (5):**
`chat:session:create`, `chat:session:list`, `chat:session:update`, `chat:session:delete`, `chat:agents:list`

**Kanban Board (6):**
`kanban-board:get`, `kanban-board:get-by-project`, `kanban-board:list`, `kanban-board:create`, `kanban-board:update`, `kanban-board:delete`

**Shell (3):**
`shell:open-in-chrome`, `shell:open-in-iterm`, `shell:open-in-vscode`

**Task Chat (2):**
`task-chat:output` (push), `task-chat:message` (push)

**Telegram (7):**
`telegram:test`, `telegram:bot-start`, `telegram:bot-stop`, `telegram:bot-status`, `telegram:bot-log` (push), `telegram:bot-session`, `telegram:bot-status-changed` (push)

## IPC Handler Registration

**Directory:** `src/main/ipc-handlers/`

IPC handlers are thin wrappers that call the daemon API client (`src/client/api-client.ts`). They do **not** call services or stores directly. All business logic runs in the daemon process. IPC handlers merely translate between the Electron IPC protocol and HTTP/WS calls to the daemon.

Handlers are split into domain-scoped files. The barrel `index.ts` calls all registrars:

| File | Domain |
|------|--------|
| `index.ts` | Barrel — registers all handlers: items, projects, tasks, pipelines, events, activity, prompts, artifacts, features, agent defs, agent libs, worktree, dashboard, debug timeline, workflow review |
| `agent-handlers.ts` | Agent start/stop/runs/send-message and push events |
| `chat-session-handlers.ts` | Chat send/stop/messages/clear/summarize/costs and session CRUD |
| `git-handlers.ts` | Task-scoped and project-scoped git operations |
| `kanban-handlers.ts` | Kanban board CRUD |
| `settings-handlers.ts` | Settings get/update |
| `shell-handlers.ts` | Open in Chrome/iTerm/VSCode |
| `telegram-handlers.ts` | Telegram bot start/stop/status/test and bot log push |

All handlers use `registerIpcHandler(channel, handler)` from the template framework. Inputs are validated with `validateId()` and `validateInput()`.

### Request-Response Pattern

Most channels use the standard IPC request-response pattern: the renderer calls an API method, the main process handler executes and returns the result.

### Push Events (main to renderer)

Push event channels stream data from daemon → Electron main → renderer:

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `navigate` | main -> renderer | Deep-link navigation from Telegram/CLI |
| `agent:output` | main -> renderer | Streams agent output chunks during execution |
| `agent:interrupted-runs` | main -> renderer | Sent on startup when orphaned runs are recovered |
| `agent:message` | main -> renderer | Structured agent chat messages (assistant text, tool use, tool result) |
| `agent:status` | main -> renderer | Agent run status changes (running, completed, failed) |
| `chat:output` | main -> renderer | Streams chat output chunks during conversation |
| `chat:message` | main -> renderer | Structured chat messages |
| `task-chat:output` | main -> renderer | Streams task-scoped chat output chunks |
| `task-chat:message` | main -> renderer | Structured task-scoped chat messages |
| `telegram:bot-log` | main -> renderer | Telegram bot activity log entries |
| `telegram:bot-status-changed` | main -> renderer | Telegram bot status change notifications |

### WebSocket Event Forwarding Chain

Push events originate in the daemon and are forwarded to the renderer through a WebSocket relay:

1. **Daemon services** emit events (e.g., `agentService` emits output chunks during agent execution)
2. **DaemonWsServer** (`src/daemon/ws/ws-server.ts`) broadcasts these events to all connected WebSocket clients
3. **Electron main process** maintains a `WsClient` (`src/client/ws-client.ts`) connected to the daemon WebSocket server
4. **WsClient** receives events and calls `sendToRenderer()` to forward them to the renderer via IPC push channels

Example flow:
```
daemon agentService → wsServer.broadcast('agent:output') → Electron wsClient → sendToRenderer(AGENT_OUTPUT) → renderer
```

## Preload Bridge

**File:** `src/preload/index.ts`

The preload script duplicates all channel constants from `src/shared/ipc-channels.ts` because Electron's sandboxed preload cannot `require()` sibling modules. A sync test (`tests/unit/ipc-channel-sync.test.ts`) ensures the two copies stay aligned.

The bridge exposes a typed `window.api` object via `contextBridge.exposeInMainWorld()`. Each domain group maps to a nested object (e.g., `window.api.tasks.list()`, `window.api.chat.send()`). Push event listeners are under `window.api.on.*` and return cleanup functions.

## Renderer Pages

**Directory:** `src/renderer/pages/`

| Page | File | Purpose |
|------|------|---------|
| Dashboard | `DashboardPage.tsx` | Stats overview with project/task/agent counts |
| Task List | `TaskListPage.tsx` | Filterable task listing |
| Task Detail | `TaskDetailPage.tsx` | Full task view with history, events, agent output |
| Projects | `ProjectsPage.tsx` | Project management |
| Project Detail | `ProjectDetailPage.tsx` | Single project details |
| Project Config | `ProjectConfigPage.tsx` | Per-project configuration |
| Feature List | `FeatureListPage.tsx` | Feature listing with progress |
| Feature Detail | `FeatureDetailPage.tsx` | Feature details with linked tasks |
| Pipelines | `PipelinesPage.tsx` | Pipeline definitions viewer |
| Agent Run | `AgentRunPage.tsx` | Agent run details and output |
| Agent Definitions | `AgentDefinitionsPage.tsx` | Agent definition management |
| Chat | `ChatPage.tsx` | Interactive chat with agents |
| Kanban Board | `KanbanBoardPage.tsx` | Kanban board view for tasks |
| Source Control | `SourceControlPage.tsx` | Git log and commit details |
| Cost | `CostPage.tsx` | Token cost tracking and breakdown |
| Telegram | `TelegramPage.tsx` | Telegram bot management and log |
| Theme | `ThemePage.tsx` | Theme customization |
| Settings | `SettingsPage.tsx` | User preferences |
| Items | `ItemsPage.tsx` | Template items (infrastructure) |
| Item Form | `ItemFormPage.tsx` | Template item edit form |

## Key Hooks

**Directory:** `src/renderer/hooks/`

### Data Fetching Hooks

| Hook | Returns | Source |
|------|---------|--------|
| `useProjects()` | `{ projects, loading, error, refetch }` | `window.api.projects.list()` |
| `useTasks(filter?)` | `{ tasks, loading, error, refetch }` | `window.api.tasks.list(filter)` |
| `usePipelines()` | `{ pipelines, loading, error, refetch }` | `window.api.pipelines.list()` |
| `useDashboard()` | `{ stats, loading, error, refetch }` | `window.api.dashboard.stats()` |
| `useFeatures(filter?)` | `{ features, loading, error, refetch }` | `window.api.features.list(filter)` |
| `useAgentDefinitions()` | `{ definitions, loading, error, refetch }` | `window.api.agentDefinitions.list()` |
| `useChat(sessionId)` | Chat state, send/stop functions | `window.api.chat.*` |
| `useChatSessions(scopeType, scopeId)` | Session CRUD operations | `window.api.chatSession.*` |
| `useKanbanBoard(projectId)` | Board config, columns, tasks | `window.api.kanbanBoards.*` |
| `useGitLog(projectId)` | Git log entries and commit details | `window.api.git.projectLog()` |

### Agent & Pipeline Hooks

| Hook | Returns | Notes |
|------|---------|-------|
| `useActiveAgentRuns()` | `{ entries, refresh }` | Polls every 3s via `window.api.agents.activeRuns()` |
| `useActiveAgents()` | Active agent entries | Thin wrapper around active runs |
| `useInterruptedRuns()` | `{ interruptedRuns, dismiss }` | Listens for `AGENT_INTERRUPTED_RUNS` push event |
| `usePipelineDiagnostics(taskId)` | Pipeline diagnostic data | Guard checks, hook failures, phase info |
| `usePipelineStatusMeta(task)` | Status metadata (label, color, category) | Derived from pipeline definition |
| `useHookRetry(taskId)` | Hook retry function | Retries failed pipeline hooks |

### UI/Interaction Hooks

| Hook | Purpose |
|------|---------|
| `useKanbanDragDrop(...)` | Drag-and-drop for kanban columns |
| `useKanbanKeyboardShortcuts(...)` | Keyboard navigation for kanban |
| `useKanbanMultiSelect(...)` | Multi-select for kanban cards |
| `useVirtualizedKanban(...)` | Virtual scrolling for large kanban boards |
| `useLocalStorage(key, default)` | Persistent local storage state |
| `useRouteRestore()` | Restores last visited route on app launch |
| `useThemeConfig()` | Theme preference management |

## Layout

### Sidebar (`src/renderer/components/layout/Sidebar.tsx`)

- 12 navigation items: Dashboard, Projects, Tasks, Kanban, Features, Chat, Cost, Source Control, Pipelines, Agents, Theme, Settings
- **SidebarSessions** — embedded component showing chat sessions
- **ActiveAgentsList** — embedded component showing running agent progress
- Bug Report button in footer
- Version display

### TopMenu (`src/renderer/components/layout/TopMenu.tsx`)

- **Left:** Project selector (dropdown from `useProjects()`)
  - Reads from `useCurrentProject()` context
  - Updates via `setCurrentProjectId(id)`
- **Right:** Theme toggle (light/dark)

### CurrentProjectContext (`src/renderer/contexts/CurrentProjectContext.tsx`)

React Context managing the active project:

1. Loads `currentProjectId` from settings on mount
2. Auto-selects first project if none stored
3. Fetches full project object when ID changes
4. Provides `setCurrentProjectId(id)` which saves to settings and refetches
5. Handles project deletion (clears selection)

## Component Organization

```
src/renderer/
├── components/
│   ├── layout/          Sidebar, TopMenu, ActiveAgentsList, Layout, SidebarSection, SidebarSessions
│   ├── ui/              Shadcn components (button, card, dialog, select, ...)
│   ├── tasks/           TaskRow, TaskFilterBar, TaskCreateDialog, TaskItemMenu
│   ├── agent-run/       OutputPanel, PromptPanel, TaskInfoPanel, SubtasksPanel,
│   │                    JSONOutputPanel, GitChangesPanel
│   ├── agents/          AgentDefinitionCard, AgentDefinitionDialog
│   ├── pipeline/        PipelineBadge
│   └── bugs/            BugReportDialog
├── contexts/            CurrentProjectContext
├── hooks/               23 hooks (see Key Hooks section)
└── pages/               20 route pages
```

## Edge Cases

- **IPC handlers are now thin proxies** — they validate inputs and forward to the daemon API client. Business logic has moved to daemon route handlers.
- **Agent output** is delivered via IPC push events, not request-response. The renderer listens for `AGENT_OUTPUT` events and appends chunks to the display buffer in real time. Events originate from the daemon WebSocket and are forwarded by the Electron WsClient.
- **Git IPC** handlers resolve the worktree path from `taskId`. The `git:diff`, `git:status`, etc. handlers look up the task's worktree to set the correct `cwd` for git operations. Project-scoped git operations (`git:project-log`, `git:branch`, `git:commit-detail`) use the project path directly.
- **Debug timeline** aggregates data from 8 tables (events, activity, transitions, agent runs, phases, artifacts, prompts, context entries). The `TASK_DEBUG_TIMELINE` IPC handler delegates to `TimelineService` in `src/core/services/timeline/timeline-service.ts`.
- **`TASK_UPDATE` strips `status`** — the IPC handler destructures `{ status, ...safeInput }` and passes only `safeInput` to the workflow service, forcing status changes through `transitionTask()`.
- **`useActiveAgentRuns` polls** rather than using push events, because the active runs endpoint returns aggregate data (including task titles). The 3-second poll interval is a pragmatic choice.
- **Preload channel sync** — a Vitest test (`tests/unit/ipc-channel-sync.test.ts`) reads the preload source as text and asserts that every channel from `src/shared/ipc-channels.ts` appears, preventing drift between the two copies.
