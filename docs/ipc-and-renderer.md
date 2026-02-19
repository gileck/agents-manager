# IPC and Renderer

IPC channels, renderer pages, hooks, and streaming.

## IPC Channel Definitions

**File:** `src/shared/ipc-channels.ts` — 57+ channels

### Channel Inventory

**Project Operations:**
`project:list`, `project:get`, `project:create`, `project:update`, `project:delete`

**Task Operations:**
`task:list`, `task:get`, `task:create`, `task:update`, `task:delete`, `task:reset`, `task:transition`, `task:transitions`, `task:dependencies`, `task:dependents`, `task:add-dependency`, `task:remove-dependency`, `task:context-entries`, `task:debug-timeline`, `task:worktree`

**Pipeline Operations:**
`pipeline:list`, `pipeline:get`

**Agent Operations:**
`agent:start`, `agent:stop`, `agent:runs`, `agent:get`, `agent:active-task-ids`, `agent:active-runs`, `agent:output` (push), `agent:interrupted-runs` (push)

**Event/Activity Operations:**
`event:list`, `activity:list`

**Prompt Operations:**
`prompt:list`, `prompt:respond`

**Artifact Operations:**
`artifact:list`

**Feature Operations:**
`feature:list`, `feature:get`, `feature:create`, `feature:update`, `feature:delete`

**Agent Definition Operations:**
`agent-def:list`, `agent-def:get`, `agent-def:create`, `agent-def:update`, `agent-def:delete`

**Git Operations:**
`git:diff`, `git:stat`, `git:working-diff`, `git:status`, `git:reset-file`, `git:clean`, `git:pull`, `git:log`, `git:show`

**Dashboard:**
`dashboard:stats`

**Settings:**
`settings:get`, `settings:update`

**App/Navigation:**
`app:get-version`, `navigate` (push)

**Template:**
`item:list`, `item:get`, `item:create`, `item:update`, `item:delete`

## IPC Handler Registration

**File:** `src/main/ipc-handlers.ts`

All handlers are registered via `registerIpcHandler(channel, handler)` from the template framework.

```typescript
export function registerIpcHandlers(services: AppServices): void {
  const {
    workflowService, taskStore, pipelineStore, projectStore,
    agentService, taskEventLog, activityLog, ...
  } = services;

  registerIpcHandler(IPC_CHANNELS.PROJECT_LIST, async () => {
    return projectStore.listProjects();
  });

  registerIpcHandler(IPC_CHANNELS.TASK_UPDATE, async (_, id: string, input: TaskUpdateInput) => {
    validateId(id);
    const { status, ...safeInput } = input; // Strip status field
    return workflowService.updateTask(id, safeInput);
  });
  // ... 50+ more handlers
}
```

### Request-Response Pattern

Most channels use the standard IPC request-response pattern: the renderer calls an API method, the main process handler executes and returns the result.

### Push Events

Two channels use push events (main → renderer):

**`AGENT_OUTPUT`** — streams agent output chunks during execution:
```typescript
// In agent-handler.ts
const onOutput = (chunk: string) => {
  sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, chunk);
};
```

**`AGENT_INTERRUPTED_RUNS`** — sent on startup when orphaned runs are recovered:
```typescript
// In main/index.ts
const recovered = await agentService.recoverOrphanedRuns();
if (recovered.length > 0) {
  sendToRenderer(IPC_CHANNELS.AGENT_INTERRUPTED_RUNS, recovered);
}
```

## Renderer Pages

**Directory:** `src/renderer/pages/`

| Page | File | Purpose |
|------|------|---------|
| Dashboard | `DashboardPage.tsx` | Stats overview with project/task/agent counts |
| Task List | `TaskListPage.tsx` | Filterable task listing |
| Task Detail | `TaskDetailPage.tsx` | Full task view with history, events, agent output |
| Projects | `ProjectsPage.tsx` | Project management |
| Project Detail | `ProjectDetailPage.tsx` | Single project details |
| Feature List | `FeatureListPage.tsx` | Feature listing with progress |
| Feature Detail | `FeatureDetailPage.tsx` | Feature details with linked tasks |
| Pipelines | `PipelinesPage.tsx` | Pipeline definitions viewer |
| Agent Run | `AgentRunPage.tsx` | Agent run details and output |
| Agent Definitions | `AgentDefinitionsPage.tsx` | Agent definition management |
| Settings | `SettingsPage.tsx` | User preferences |
| Items | `ItemsPage.tsx` | Template items (infrastructure) |
| Item Form | `ItemFormPage.tsx` | Template item edit form |
| Home | `HomePage.tsx` | Landing page |

## Key Hooks

**Directory:** `src/renderer/hooks/`

### `useProjects()`

Returns `{ projects, loading, error, refetch }`. Calls `window.api.projects.list()`.

### `useTasks(filter?: TaskFilter)`

Returns `{ tasks, loading, error, refetch }`. Calls `window.api.tasks.list(filter)`.
Variant: `useTask(id)` returns a single task.

### `usePipelines()`

Returns `{ pipelines, loading, error, refetch }`. Calls `window.api.pipelines.list()`.
Variant: `usePipeline(id)` for a single pipeline.

### `useDashboard()`

Returns `{ stats, loading, error, refetch }`. Calls `window.api.dashboard.stats()`.

### `useFeatures(filter?)`

Returns `{ features, loading, error, refetch }`. Calls `window.api.features.list(filter)`.
Variant: `useFeature(id)` for a single feature.

### `useAgentDefinitions()`

Returns `{ definitions, loading, error, refetch }`. Calls `window.api.agentDefinitions.list()`.

### `useActiveAgentRuns()`

Returns `{ entries: ActiveAgentEntry[], refresh }`.

- Polls every 3 seconds via `window.api.agents.activeRuns()`
- Detects run completion by comparing current vs previous active run sets
- Fetches task titles on demand
- Merges active + recently completed runs in the view
- `ActiveAgentEntry = { run: AgentRun, taskTitle: string }`

### `useInterruptedRuns()`

Returns `{ interruptedRuns, dismiss }`.

- Listens for the `AGENT_INTERRUPTED_RUNS` push event on mount
- Displays recovered runs so the user knows agents were interrupted

## Layout

### Sidebar (`src/renderer/components/layout/Sidebar.tsx`)

- 7 navigation items: Dashboard, Projects, Tasks, Features, Pipelines, Agents, Settings
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
│   ├── layout/          Sidebar, TopMenu, ActiveAgentsList, Layout
│   ├── ui/              Shadcn components (button, card, dialog, select, ...)
│   ├── tasks/           TaskRow, TaskFilterBar, TaskCreateDialog, TaskItemMenu
│   ├── agent-run/       OutputPanel, PromptPanel, TaskInfoPanel, SubtasksPanel,
│   │                    JSONOutputPanel, GitChangesPanel
│   ├── agents/          AgentDefinitionCard, AgentDefinitionDialog
│   ├── pipeline/        PipelineBadge
│   └── bugs/            BugReportDialog
├── contexts/            CurrentProjectContext
├── hooks/               useProjects, useTasks, usePipelines, useDashboard,
│                        useFeatures, useAgentDefinitions, useActiveAgentRuns,
│                        useInterruptedRuns
└── pages/               14 route pages
```

## Edge Cases

- **Agent output** is delivered via IPC push events, not request-response. The renderer listens for `AGENT_OUTPUT` events and appends chunks to the display buffer in real time.
- **Git IPC** handlers resolve the worktree path from `taskId`. The `git:diff`, `git:status`, etc. handlers look up the task's worktree to set the correct `cwd` for git operations.
- **Debug timeline** aggregates data from 8 tables (events, activity, transitions, agent runs, phases, artifacts, prompts, context entries). The `TASK_DEBUG_TIMELINE` IPC handler performs the aggregation.
- **`TASK_UPDATE` strips `status`** — the IPC handler destructures `{ status, ...safeInput }` and passes only `safeInput` to the workflow service, forcing status changes through `transitionTask()`.
- **`useActiveAgentRuns` polls** rather than using push events, because the active runs endpoint returns aggregate data (including task titles). The 3-second poll interval is a pragmatic choice.
