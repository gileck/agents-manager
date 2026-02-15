# App UI: Electron React Frontend

The primary interface for managing tasks, viewing agent output, and interacting with the pipeline. The App UI is the Electron renderer process -- a React application that displays state and sends commands to the WorkflowService via IPC.

See also: [workflow-service.md](workflow-service.md) | [pipeline/ui.md](pipeline/ui.md) | [overview.md](overview.md)

---

## Overview

- **Electron 28 + React 19 + TypeScript** -- the renderer process is a standard React SPA running inside a BrowserWindow
- **Tailwind CSS** for styling, with inline style fallbacks for grids, explicit widths, and colored backgrounds (see Known Issues in CLAUDE.md)
- **Thin UI layer** -- the renderer displays state and sends commands. Zero business logic lives in the renderer process. All mutations go through the WorkflowService via IPC.
- **Pipeline-driven** -- the UI never hardcodes statuses, transitions, or workflow rules. It always asks the pipeline engine what to display and what actions are valid.

---

## Architecture

```
┌──────────────────────────────────┐
│  React App (renderer process)     │
│  Pages → Components → Hooks      │
└──────────────┬───────────────────┘
               │ IPC (contextBridge)
┌──────────────▼───────────────────┐
│  Preload (context bridge)         │
│  Exposes typed API                │
└──────────────┬───────────────────┘
               │ ipcRenderer.invoke / ipcMain.handle
┌──────────────▼───────────────────┐
│  IPC Handlers                     │
│  Thin layer → WorkflowService     │
└──────────────────────────────────┘
```

The preload script exposes a typed API to the renderer via `contextBridge.exposeInMainWorld`. Each IPC channel maps 1:1 to a WorkflowService method. IPC handlers contain zero logic -- they destructure arguments and forward to the service.

**Data flow:** React hook calls `window.api.tasks.list(projectId)` → preload calls `ipcRenderer.invoke('tasks:list', projectId)` → IPC handler calls `workflowService.listTasks(projectId)` → result flows back through the same chain.

---

## Pages & Routes

| Page | Route | Phase | Description |
|------|-------|-------|-------------|
| Dashboard | `/` | 4 | Stat cards, charts, active agents, activity feed, cost summary |
| Projects | `/projects` | 1 | List/create/edit projects |
| Task Board | `/projects/:id/board` | 1 | Kanban view grouped by pipeline statuses |
| Task List | `/projects/:id/tasks` | 1 | Table view with filters and sort |
| Task Detail | `/projects/:id/tasks/:taskId` | 1 | Full task view: metadata, plan, artifacts, history, agent controls |
| Task Form | `/projects/:id/tasks/new` or `/:taskId/edit` | 1 | Create/edit task form |
| Agent Runs | `/projects/:id/agents` | 2 | Project-level agent run history |
| Agent Run Detail | `/projects/:id/agents/:runId` | 2 | Full transcript viewer |
| Workflow Visualizer | `/projects/:id/workflow` | 4 | Pipeline graph (React Flow) |
| Settings | `/settings` | 1 | Theme, defaults, agent config, supervisor config |

---

## Layout / Navigation

Sidebar layout. The sidebar is always visible and provides project-scoped navigation.

```
┌──────────────────┐
│  Agents Manager   │
│                   │
│  [Project Picker] │
│                   │
│  Board            │
│  Tasks            │
│  Agents     (P2)  │
│  Dashboard  (P4)  │
│                   │
│  ─────────────    │
│  Settings         │
│  Projects         │
└──────────────────┘
```

- **App title** at the top
- **Project picker dropdown** -- selects the active project, scopes all views below
- **Nav items** -- Board, Tasks, Agents (Phase 2), Dashboard (Phase 4)
- **Divider**
- **Settings** -- global app settings
- **Projects** -- manage projects (add, edit, remove)

The sidebar uses inline styles for width (`style={{ width: '250px' }}`) because Tailwind width classes fail in Electron.

---

## Key Components (by page)

### Task Board

| Component | Description |
|-----------|-------------|
| `KanbanBoard` | Horizontal scrollable board. Columns come from the pipeline definition, not a hardcoded list. |
| `KanbanColumn` | A single status column. Dynamically generated from `usePipelineStatuses()`. Adding a status to the pipeline automatically adds a column -- zero UI code changes. |
| `TaskCard` | Compact card showing title, priority badge, size, tags. |
| `TaskQuickAdd` | Inline "add task" input at the top of the "Open" column. |

Drag-and-drop between columns triggers a pipeline transition via `useTransition()`. If the transition is blocked by a guard, the card snaps back and a tooltip explains why.

### Task Detail

| Component | Phase | Description |
|-----------|-------|-------------|
| `TaskDetailHeader` | 1 | Title, status badge, transition buttons |
| `TaskMetadataBadges` | 1 | Priority, size, complexity badges |
| `TaskStatusActions` | 1 | Shows ONLY valid transitions (from pipeline engine). Disabled buttons show guard failure reason as tooltip. |
| `PlanEditor` | 1 | Editable markdown viewer for the task plan |
| `ArtifactsPanel` | 2 | Branches, PRs, commits, diff stats |
| `DependencyList` | 1 | Task dependencies with status indicators |
| `AgentControls` | 2 | Plan / Implement / Stop buttons |
| `AgentRunList` | 2 | List of agent runs for this task |
| `LiveOutputPanel` | 2 | Streaming agent output (real-time via IPC events) |
| `MergeButton` | 2 | Reads PR artifact, calls `workflowService.mergePR()`, auto-transitions to Done |
| `TransitionHistory` | 1 | Timeline of status changes with timestamps, actors, and reasons |
| `WorkflowMiniGraph` | 4 | Embedded pipeline visualization showing the task's position and journey |

### Agent Run Detail

| Component | Phase | Description |
|-----------|-------|-------------|
| `TranscriptViewer` | 2 | Full agent conversation, scrollable |
| `TranscriptMessage` | 2 | Single message bubble (user/assistant/system) |
| `ToolUseBlock` | 2 | Collapsible display for tool_use calls and results |
| `RunStatusBar` | 2 | Status, duration, cost, model info |
| `DiffViewer` | 5 | File diffs showing what the agent changed |

### Dashboard (Phase 4)

| Component | Description |
|-----------|-------------|
| `StatCard` | Large number with label (total tasks, active agents, cost this week, etc.) |
| `TaskStatusChart` | Bar chart of tasks by status (recharts) |
| `ActiveAgentsList` | Currently running agents with progress indicators |
| `ActivityFeed` | Chronological event list (task created, agent completed, etc.) |
| `CompletionTrendChart` | Line chart of task completions over time |
| `CostSummary` | Cost breakdown by agent type, project, time period |

---

## React Hooks

Hooks are the **only way** the UI interacts with data. They abstract the IPC layer and manage local state, loading, and error handling.

### Pipeline Hooks

```typescript
// Get the pipeline definition for a project
function usePipeline(projectId: string): PipelineDefinition

// Get valid transitions for a task (determines which buttons to show)
function useValidTransitions(taskId: string): ValidTransition[]

// Get transition history for a task (timeline view)
function useTransitionHistory(taskId: string): TransitionHistoryEntry[]

// Execute a transition (returns a mutation function)
function useTransition(): (taskId: string, toStatus: string, reason?: string) => Promise<TransitionResult>

// Get all statuses for the active pipeline (for kanban columns, filters)
function usePipelineStatuses(projectId: string): PipelineStatus[]

// Check if a status is terminal (for conditional rendering)
function useIsTerminal(pipelineId: string, statusId: string): boolean
```

### Task Hooks

```typescript
// List tasks with optional filters
function useTasks(projectId: string, filters?: TaskFilters): Task[]

// Get a single task
function useTask(taskId: string): Task

// Create a task (returns a mutation function)
function useCreateTask(): (input: CreateTaskInput) => Promise<Task>

// Update a task (returns a mutation function)
function useUpdateTask(): (id: string, input: UpdateTaskInput) => Promise<Task>
```

### Agent Hooks

```typescript
// List agent runs with optional filters
function useAgentRuns(filters: { taskId?: string; projectId?: string }): AgentRun[]

// Get a single agent run
function useAgentRun(runId: string): AgentRun

// Start an agent (returns a mutation function)
function useStartAgent(): (taskId: string, mode: string, config?: Partial<AgentConfig>) => Promise<AgentRun>

// Stop a running agent (returns a mutation function)
function useStopAgent(): (runId: string) => Promise<void>

// Subscribe to real-time agent output (streaming messages)
function useAgentOutput(runId: string): AgentMessage[]
```

### Critical Rule: Never Check Status Strings

The UI never inspects status values directly. Always ask the pipeline engine:

```typescript
// WRONG - hardcoded status check
if (task.status === 'done') { /* terminal */ }

// RIGHT - ask the pipeline engine
const isTerminal = useIsTerminal(task.pipelineId, task.status);
```

This ensures the UI works correctly with any pipeline configuration, including custom pipelines where "done" might not exist or might not be terminal.

---

## IPC Layer

### Preload Script

The preload script exposes a typed API to the renderer via `contextBridge`:

```typescript
// src/preload/index.ts
contextBridge.exposeInMainWorld('api', {
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    get: (id: string) => ipcRenderer.invoke('projects:get', id),
    create: (input: CreateProjectInput) => ipcRenderer.invoke('projects:create', input),
    update: (id: string, input: UpdateProjectInput) => ipcRenderer.invoke('projects:update', id, input),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id),
  },
  tasks: {
    list: (projectId: string, filters?: TaskFilters) => ipcRenderer.invoke('tasks:list', projectId, filters),
    get: (taskId: string) => ipcRenderer.invoke('tasks:get', taskId),
    create: (input: CreateTaskInput) => ipcRenderer.invoke('tasks:create', input),
    update: (taskId: string, input: UpdateTaskInput) => ipcRenderer.invoke('tasks:update', taskId, input),
    delete: (taskId: string) => ipcRenderer.invoke('tasks:delete', taskId),
  },
  agent: {
    start: (taskId: string, mode: string) => ipcRenderer.invoke('agent:start', taskId, mode),
    stop: (runId: string) => ipcRenderer.invoke('agent:stop', runId),
    getRun: (runId: string) => ipcRenderer.invoke('agent:get-run', runId),
    listRuns: (filters: { taskId?: string; projectId?: string }) => ipcRenderer.invoke('agent:list-runs', filters),
    onOutput: (callback: (msg: AgentMessage) => void) => {
      ipcRenderer.on('agent:output', (_, msg) => callback(msg));
    },
    onCompleted: (callback: (run: AgentRun) => void) => {
      ipcRenderer.on('agent:completed', (_, run) => callback(run));
    },
  },
  pipeline: {
    get: (projectId: string) => ipcRenderer.invoke('pipeline:get', projectId),
    getValidTransitions: (taskId: string) => ipcRenderer.invoke('pipeline:valid-transitions', taskId),
    transition: (taskId: string, toStatus: string, context: TransitionContext) =>
      ipcRenderer.invoke('pipeline:transition', taskId, toStatus, context),
    getHistory: (taskId: string) => ipcRenderer.invoke('pipeline:history', taskId),
    getStatuses: (projectId: string) => ipcRenderer.invoke('pipeline:statuses', projectId),
  },
  events: {
    onTaskEvent: (callback: (event: TaskEvent) => void) => {
      ipcRenderer.on('events:task-event', (_, event) => callback(event));
    },
  },
});
```

Every method is a thin wrapper around `ipcRenderer.invoke` or `ipcRenderer.on`. No data transformation, no validation, no logic.

### IPC Handlers (Main Process)

On the main process side, IPC handlers are equally thin -- they destructure arguments and forward to the WorkflowService:

```typescript
// src/main/ipc-handlers.ts
export function registerIpcHandlers(workflowService: IWorkflowService) {
  ipcMain.handle('tasks:list', (_, projectId, filters) =>
    workflowService.listTasks(projectId, filters));

  ipcMain.handle('tasks:create', (_, input) =>
    workflowService.createTask(input));

  ipcMain.handle('pipeline:transition', (_, taskId, toStatus, context) =>
    workflowService.transitionTask(taskId, toStatus, context));

  ipcMain.handle('agent:start', (_, taskId, mode, config) =>
    workflowService.startAgent(taskId, mode, config));

  // ... all handlers follow the same pattern
}
```

Zero logic. See [workflow-service.md](workflow-service.md) for the full list of IPC channel mappings.

---

## Real-time Updates

Agent output and task events stream via IPC events (push from main to renderer), not request/response:

| IPC Event | Description | Used By |
|-----------|-------------|---------|
| `agent:output` | Streamed messages from a running agent | `LiveOutputPanel`, `useAgentOutput` |
| `agent:completed` | Agent run finished (success or failure) | `AgentControls`, `AgentRunList` |
| `events:task-event` | Task event log update (status change, note added, etc.) | `TransitionHistory`, `ActivityFeed` |

React hooks subscribe to these events on mount and unsubscribe on unmount. State updates flow through the hooks, which re-render the relevant components.

```typescript
// Simplified example: useAgentOutput hook
function useAgentOutput(runId: string): AgentMessage[] {
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  useEffect(() => {
    const handler = (msg: AgentMessage) => {
      if (msg.runId === runId) {
        setMessages(prev => [...prev, msg]);
      }
    };
    window.api.agent.onOutput(handler);
    return () => { /* cleanup listener */ };
  }, [runId]);

  return messages;
}
```

---

## Styling Approach

### What Works in Electron

- **Tailwind CSS** for spacing (`p-4`, `m-2`, `gap-3`), flexbox (`flex`, `items-center`, `justify-between`), text (`text-sm`, `font-bold`, `text-muted-foreground`), borders (`border`, `border-b`, `rounded-lg`), and interactive states (`hover:`, `group-hover:`)
- **Shadcn-style UI components** from the template (`Button`, `Dialog`, `Select`, `Input`, etc.)
- **`createPortal`** for modals -- portal into `#app-root` with `absolute` positioning instead of `fixed`. The layout container must have `position: relative`.

### What Fails in Electron (Use Inline Styles)

- **Grid layouts** (`grid grid-cols-4`) -- renders as single column
- **Explicit widths** (`w-64`, `w-40`) -- ignored
- **Background colors with opacity** (`bg-yellow-500/10`, `bg-muted/50`) -- not applied

```typescript
// Use inline styles for these cases
<div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
<div style={{ width: '250px' }}>
<div style={{ backgroundColor: 'rgba(234, 179, 8, 0.1)' }}>
```

See Known Issues #7 in `CLAUDE.md` for the full list.

---

## File Structure

```
src/renderer/
├── App.tsx                    # React Router setup
├── pages/
│   ├── DashboardPage.tsx     # P4
│   ├── ProjectsPage.tsx
│   ├── TaskBoardPage.tsx
│   ├── TaskListPage.tsx
│   ├── TaskDetailPage.tsx
│   ├── TaskFormPage.tsx
│   ├── AgentRunsPage.tsx     # P2
│   ├── AgentRunDetailPage.tsx # P2
│   ├── WorkflowPage.tsx      # P4
│   └── SettingsPage.tsx
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   └── Layout.tsx
│   ├── board/
│   │   ├── KanbanBoard.tsx
│   │   ├── KanbanColumn.tsx
│   │   └── TaskCard.tsx
│   ├── task/
│   │   ├── TaskDetailHeader.tsx
│   │   ├── TaskStatusActions.tsx
│   │   ├── ArtifactsPanel.tsx
│   │   ├── PlanEditor.tsx
│   │   ├── DependencyList.tsx
│   │   ├── TransitionHistory.tsx
│   │   └── ...
│   ├── agent/
│   │   ├── AgentControls.tsx
│   │   ├── TranscriptViewer.tsx
│   │   ├── LiveOutputPanel.tsx
│   │   ├── TranscriptMessage.tsx
│   │   ├── ToolUseBlock.tsx
│   │   ├── RunStatusBar.tsx
│   │   └── ...
│   ├── workflow/
│   │   ├── WorkflowVisualizer.tsx
│   │   ├── StatusNode.tsx
│   │   └── TransitionEdge.tsx
│   └── common/
│       ├── MarkdownViewer.tsx
│       └── ...
├── hooks/
│   ├── usePipeline.ts
│   ├── useTasks.ts
│   ├── useAgent.ts
│   └── ...
└── styles/
    └── globals.css
```

**Key conventions:**
- Pages are top-level route components. They compose smaller components and connect hooks.
- Components are organized by domain (board, task, agent, workflow) plus a `common/` directory for shared UI primitives.
- Hooks are organized by domain and are the sole interface between the UI and the IPC layer.
- No business logic in any renderer file. If it requires a decision beyond "display this data" or "call this API", it belongs in the WorkflowService.

---

## Phase Rollout

### Phase 1 -- Foundation
- Projects page (list, create, edit, delete, directory picker)
- Task Board page (pipeline-driven kanban with dynamic columns)
- Task List page (table with filters and sort)
- Task Detail page (metadata, plan editor, dependencies, transition history)
- Task Form page (create/edit)
- Settings page (theme, defaults)
- Sidebar layout with project picker and navigation
- All pipeline hooks (`usePipeline`, `useValidTransitions`, `useTransition`, `usePipelineStatuses`)
- All task hooks (`useTasks`, `useTask`, `useCreateTask`, `useUpdateTask`)

### Phase 2 -- Agent Execution
- Agent controls on Task Detail (Plan / Implement / Stop buttons)
- Live output panel (streaming agent messages)
- Agent Run List on Task Detail
- Agent Runs page (project-level history)
- Agent Run Detail page (transcript viewer, tool use blocks, status bar)
- Merge button (reads PR artifact, triggers merge + transition)
- Artifacts panel on Task Detail
- All agent hooks (`useAgentRuns`, `useAgentRun`, `useStartAgent`, `useStopAgent`, `useAgentOutput`)

### Phase 4 -- Dashboard + Polish
- Dashboard page (stat cards, charts, active agents, activity feed, cost summary)
- Workflow Visualizer page (React Flow pipeline graph)
- Workflow mini-graph embedded in Task Detail
- Bulk operations (multi-select tasks, bulk transition)
- Activity feed component

### Phase 5 -- Advanced
- Diff viewer on Agent Run Detail (file-by-file diffs of agent changes)
- Template picker for new tasks
- GitHub issues import dialog
- Agent queue panel (view and manage queued agent runs)

---

## Cross-references

- **[workflow-service.md](workflow-service.md)** -- the service the UI calls for all operations
- **[pipeline/ui.md](pipeline/ui.md)** -- pipeline-specific UI details (kanban, workflow visualizer, pipeline editor, IPC channels)
- **[overview.md](overview.md)** -- IPC patterns, dependency injection, interface definitions
- **[projects.md](projects.md)** -- project data model, directory picker, IPC channels
- **[notification-system.md](notification-system.md)** -- bidirectional notification channels (the other UIs alongside this one)
